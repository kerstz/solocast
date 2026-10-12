import { randomUUID } from "node:crypto";
import {
  CHAT_FLOOD_MAX_REJECTIONS,
  CHAT_FLOOD_WINDOW_MS,
  CLIENT_EVENTS,
  ClientWsMessageSchema,
  MAX_SPEAKERS,
  SERVER_EVENTS,
  VIEWER_COLORS,
  WS_CLOSE_CODES,
  type ChatMessage,
  type ClientWsMessage,
  type PresenceUpdate,
  type ServerWsMessage,
  type ViewerColor,
} from "@solocast/shared";
import type { FastifyBaseLogger } from "fastify";
import { STREAMER_IDENTITY } from "../livekit/grants.js";
import { STAGE_REQUEST_RATE_LIMIT } from "../routes/stage.js";
import type { StageNotification, StageNotifier } from "../stage/stage-notifier.js";
import type { BusEnvelope, BusTarget, ChatBus, Unsubscribe } from "./bus.js";
import type { SlidingWindowLimiter } from "./rate-limit.js";
import type { ChatState } from "./state.js";

export const STREAMER_PSEUDO = "Streameur";
// Couleur réservée au streameur dans le chat (première de la palette partagée).
export const STREAMER_COLOR: ViewerColor = VIEWER_COLORS[0];
// Fenêtre de coalescence des diffusions de présence : une seule diffusion par rafale
// (connexions/déconnexions en masse), au lieu d'un recalcul par événement.
export const PRESENCE_COALESCE_MS = 400;
export const PRESENCE_TTL_SECONDS = 60;
// Présence SFU du streameur (webhook participant_joined) : TTL long, retirée au participant_left.
export const SFU_STREAMER_LINK_ID = "sfu";
export const SFU_STREAMER_LINK_TTL_SECONDS = 6 * 60 * 60;
// Diffusion périodique de la présence (rafraîchit aussi les TTL des connexions locales).
export const PRESENCE_TICK_MS = 10_000;

export type ChatIdentity =
  | { role: "viewer"; viewerId: string; pseudo: string | null; color: ViewerColor | null }
  // tokenId : identifiant de session studio, utilisé pour prolonger le bail du studio.
  | { role: "streamer"; tokenId: string };

// Sous-ensemble de WebSocket utilisé par le hub (permet un fake sans réseau).
export interface ChatSocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface ChatConnection {
  receive(raw: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface ChatHubDeps {
  bus: ChatBus;
  state: ChatState;
  limiter: SlidingWindowLimiter;
  // Places viewer du salon : prolongées tant qu'un onglet est ouvert, rendues à la dernière
  // déconnexion. La prise de place se fait avant l'upgrade (passerelle WS) et dans /api/token.
  viewerSlots: {
    take(viewerId: string): Promise<boolean>;
    release(viewerId: string): Promise<void>;
  };
  /** Plafond de viewers simultanés, publié tel quel dans presence:update. */
  maxViewers: number;
  /** Prolonge le bail du studio tant que le streameur a une socket ouverte. */
  renewStudioLease(tokenId: string): Promise<void>;
  countSpeakers(): Promise<number>;
  /** Le viewer tient-il une place de parole ? Évite un appel SFU inutile à chaque déconnexion. */
  isSpeaker(viewerId: string): Promise<boolean>;
  // Retire le droit de parole (Redis + SFU + stage:revoked). Retourne le nom de l'erreur SFU
  // si la coupure n'a pas été confirmée : le droit est retiré dans tous les cas.
  leaveStage(viewerId: string): Promise<string | undefined>;
  chatRateLimit: { max: number; windowMs: number };
  // Coalescence des diffusions de présence (ms). 0 = diffusion immédiate (tests).
  presenceCoalesceMs?: number;
  log: FastifyBaseLogger;
}

export interface ChatHub extends StageNotifier {
  start(): void;
  stop(): void;
  open(socket: ChatSocket, identity: ChatIdentity): Promise<ChatConnection>;
  // Ferme toutes les connexions WS du viewer, sur toutes les instances.
  closeViewer(viewerId: string, code: number, reason: string): Promise<void>;
  setStreamerSfuPresent(present: boolean): Promise<void>;
  refreshPresence(): Promise<void>;
}

interface Connection {
  id: string;
  identity: ChatIdentity;
  socket: ChatSocket;
  rejections: number[];
}

interface LocalViewer {
  count: number;
  pseudo: string | null;
}

const ALL: BusTarget = { to: "all" };
const STREAMER_TARGET: BusTarget = { to: "streamer" };

function matches(target: BusTarget, identity: ChatIdentity): boolean {
  if (target.to === "all") {
    return true;
  }
  if (target.to === "streamer") {
    return identity.role === "streamer";
  }
  return identity.role === "viewer" && identity.viewerId === target.viewerId;
}

function parseClientMessage(raw: string): ClientWsMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientWsMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function createChatHub(deps: ChatHubDeps): ChatHub {
  const { bus, state, limiter, log } = deps;
  const connections = new Map<string, Connection>();
  const localViewers = new Map<string, LocalViewer>();
  let unsubscribe: Unsubscribe | undefined;
  let timer: NodeJS.Timeout | undefined;

  const publish = (target: BusTarget, event: ServerWsMessage): Promise<void> =>
    bus.publish({ kind: "event", target, event });

  // Livraison locale : seule une socket dont l'identité correspond à la cible reçoit l'envelope.
  function deliver(envelope: BusEnvelope): void {
    for (const conn of [...connections.values()]) {
      if (!matches(envelope.target, conn.identity)) {
        continue;
      }
      try {
        if (envelope.kind === "event") {
          conn.socket.send(JSON.stringify(envelope.event));
        } else {
          conn.socket.close(envelope.code, envelope.reason);
        }
      } catch {
        log.warn({ event: "chat.deliver_failed", connectionId: conn.id }, "Envoi WS échoué");
      }
    }
  }

  const notice = (conn: Connection, message: string): void => {
    conn.socket.send(JSON.stringify({ type: SERVER_EVENTS.SYSTEM_NOTICE, payload: { message } }));
  };

  // Compte les rejets (rate-limit, message invalide) : au-delà du seuil dans la fenêtre, fermeture.
  function reject(conn: Connection, message: string): void {
    const now = Date.now();
    conn.rejections = [...conn.rejections.filter((ts) => ts > now - CHAT_FLOOD_WINDOW_MS), now];
    notice(conn, message);
    if (conn.rejections.length >= CHAT_FLOOD_MAX_REJECTIONS) {
      log.warn({ event: "chat.flood_closed", connectionId: conn.id }, "Connexion fermée : flood");
      conn.socket.close(WS_CLOSE_CODES.FLOOD, "Flood detected.");
    }
  }

  async function buildPresence(): Promise<PresenceUpdate> {
    // `live` = le streameur publie sur le SFU (webhook participant_joined), et rien d'autre :
    // ouvrir la page studio ne met pas le salon en direct.
    const [entries, streamerOnSfu, speakers] = await Promise.all([
      state.listPresence(),
      state.hasStreamerLink(SFU_STREAMER_LINK_ID),
      deps.countSpeakers(),
    ]);
    const pseudos = entries
      .flatMap((entry) => (entry.pseudo === null ? [] : [entry.pseudo]))
      .sort((a, b) => a.localeCompare(b));
    return {
      count: entries.length,
      pseudos,
      live: streamerOnSfu,
      speakers: Math.min(speakers, MAX_SPEAKERS),
      maxViewers: deps.maxViewers,
    };
  }

  async function broadcastPresence(): Promise<void> {
    await publish(ALL, { type: SERVER_EVENTS.PRESENCE_UPDATE, payload: await buildPresence() });
  }

  // Diffusion coalescée : la première demande part tout de suite, les suivantes dans la fenêtre
  // sont fusionnées en une seule diffusion de fin. Évite un recalcul complet par connexion.
  const coalesceMs = deps.presenceCoalesceMs ?? PRESENCE_COALESCE_MS;
  let cooldown: NodeJS.Timeout | undefined;
  let presencePending = false;

  function runPresence(): Promise<void> {
    presencePending = false;
    cooldown = setTimeout(() => {
      cooldown = undefined;
      if (presencePending) {
        void runPresence();
      }
    }, coalesceMs);
    cooldown.unref();
    return broadcastPresence().catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      log.error({ event: "chat.presence_failed", errorName }, "Diffusion de présence échouée");
    });
  }

  async function schedulePresence(): Promise<void> {
    if (coalesceMs <= 0) {
      await broadcastPresence();
      return;
    }
    if (cooldown !== undefined) {
      presencePending = true;
      return;
    }
    await runPresence();
  }

  async function handleChat(conn: Connection, text: string): Promise<void> {
    const { identity } = conn;
    if (identity.role === "viewer" && identity.pseudo === null) {
      reject(conn, "Pick a username before chatting.");
      return;
    }
    const key = identity.role === "streamer" ? STREAMER_IDENTITY : identity.viewerId;
    const accepted = await limiter.hit(
      `chat:rl:${key}`,
      deps.chatRateLimit.max,
      deps.chatRateLimit.windowMs,
    );
    if (!accepted) {
      reject(conn, "Too many messages, slow down.");
      return;
    }
    const color = identity.role === "streamer" ? STREAMER_COLOR : identity.color;
    const message: ChatMessage = {
      id: randomUUID(),
      userId: key,
      pseudo: identity.role === "streamer" ? STREAMER_PSEUDO : (identity.pseudo ?? ""),
      text,
      ts: Date.now(),
      isStreamer: identity.role === "streamer",
      ...(color === null ? {} : { color }),
    };
    await state.appendHistory(message);
    await publish(ALL, { type: SERVER_EVENTS.CHAT_MESSAGE, payload: message });
    // Journal : identifiants et longueur uniquement, jamais le texte.
    log.info(
      { event: "chat.message", role: identity.role, userId: key, length: text.length },
      "Message chat diffusé",
    );
  }

  async function handleStageRequest(conn: Connection): Promise<void> {
    const { identity } = conn;
    if (identity.role === "streamer") {
      notice(conn, "The streamer is already on air.");
      return;
    }
    if (identity.pseudo === null) {
      reject(conn, "Pick a username before asking to speak.");
      return;
    }
    const accepted = await limiter.hit(
      `stage:rl:${identity.viewerId}`,
      STAGE_REQUEST_RATE_LIMIT.max,
      STAGE_REQUEST_RATE_LIMIT.timeWindow,
    );
    if (!accepted) {
      reject(conn, "A stage request was already sent recently.");
      return;
    }
    await notify({
      event: CLIENT_EVENTS.STAGE_REQUEST,
      viewerId: identity.viewerId,
      pseudo: identity.pseudo,
    });
  }

  async function handleStageLeave(conn: Connection): Promise<void> {
    const { identity } = conn;
    if (identity.role === "streamer") {
      notice(conn, "The streamer cannot leave the stage.");
      return;
    }
    // Le droit est retiré et stage:revoked est émis même si le SFU n'a pas confirmé :
    // pas de notice d'erreur au viewer pour une action qui a bien eu lieu côté serveur.
    const sfuErrorName = await deps.leaveStage(identity.viewerId);
    log.info(
      { event: "stage.left", ...(sfuErrorName === undefined ? {} : { sfuErrorName }) },
      "Viewer a quitté la scène",
    );
  }

  async function receive(conn: Connection, raw: string): Promise<void> {
    if (!connections.has(conn.id)) {
      return;
    }
    const message = parseClientMessage(raw);
    if (message === null) {
      reject(conn, "Invalid message.");
      return;
    }
    try {
      switch (message.type) {
        case CLIENT_EVENTS.CHAT_SEND:
          await handleChat(conn, message.payload.text);
          return;
        case CLIENT_EVENTS.STAGE_REQUEST:
          await handleStageRequest(conn);
          return;
        case CLIENT_EVENTS.STAGE_LEAVE:
          await handleStageLeave(conn);
          return;
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      log.error({ event: "chat.handler_failed", errorName }, "Traitement WS échoué");
      notice(conn, "Action failed, try again.");
    }
  }

  async function dispose(conn: Connection): Promise<void> {
    if (!connections.delete(conn.id)) {
      return;
    }
    if (conn.identity.role === "viewer") {
      const { viewerId } = conn.identity;
      const entry = localViewers.get(viewerId);
      if (entry !== undefined && entry.count > 1) {
        entry.count -= 1;
      } else {
        localViewers.delete(viewerId);
        await state.removePresence(viewerId);
        await deps.viewerSlots.release(viewerId);
        // Dernier onglet fermé : la place de parole est rendue tout de suite. Sans ça, un
        // speaker qui ferme brutalement bloquerait une place sur MAX_SPEAKERS jusqu'à
        // l'expiration du grant (24 h), et la jauge « x/8 » resterait fausse.
        if (await deps.isSpeaker(viewerId)) {
          const sfuErrorName = await deps.leaveStage(viewerId);
          log.info(
            {
              event: "stage.left_on_disconnect",
              ...(sfuErrorName === undefined ? {} : { sfuErrorName }),
            },
            "Place de parole rendue à la déconnexion",
          );
        }
      }
    }
    await schedulePresence();
    log.info({ event: "chat.disconnected", connectionId: conn.id }, "Connexion chat fermée");
  }

  async function notify(notification: StageNotification): Promise<void> {
    switch (notification.event) {
      case SERVER_EVENTS.STAGE_GRANTED:
        await publish(
          { to: "viewer", viewerId: notification.viewerId },
          { type: SERVER_EVENTS.STAGE_GRANTED },
        );
        return;
      case SERVER_EVENTS.STAGE_REVOKED:
        await publish(
          { to: "viewer", viewerId: notification.viewerId },
          { type: SERVER_EVENTS.STAGE_REVOKED },
        );
        return;
      case CLIENT_EVENTS.STAGE_REQUEST:
        // Pas de pseudo : la demande n'est pas transmissible au format serveur (pseudo requis).
        if (notification.pseudo === null) {
          return;
        }
        await publish(STREAMER_TARGET, {
          type: SERVER_EVENTS.STAGE_REQUEST,
          payload: { viewerId: notification.viewerId, pseudo: notification.pseudo },
        });
        return;
    }
  }

  async function tick(): Promise<void> {
    try {
      for (const [viewerId, entry] of localViewers) {
        await state.touchPresence(viewerId, entry.pseudo, PRESENCE_TTL_SECONDS);
        // Prolonge la place : un viewer connecté ne se fait jamais évincer par l'expiration.
        await deps.viewerSlots.take(viewerId);
      }
      for (const conn of connections.values()) {
        if (conn.identity.role === "streamer") {
          await deps.renewStudioLease(conn.identity.tokenId);
        }
      }
      await schedulePresence();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      log.error({ event: "chat.tick_failed", errorName }, "Rafraîchissement présence échoué");
    }
  }

  return {
    start() {
      unsubscribe = bus.subscribe(deliver);
      timer = setInterval(() => void tick(), PRESENCE_TICK_MS);
      timer.unref();
    },

    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
      }
      if (cooldown !== undefined) {
        clearTimeout(cooldown);
        cooldown = undefined;
      }
      presencePending = false;
      unsubscribe?.();
      unsubscribe = undefined;
    },

    async open(socket, identity) {
      const history = await state.recentHistory();
      const conn: Connection = { id: randomUUID(), identity, socket, rejections: [] };
      // Historique envoyé avant tout événement live de cette socket (pas d'await entre les deux).
      connections.set(conn.id, conn);
      socket.send(JSON.stringify({ type: SERVER_EVENTS.CHAT_HISTORY, payload: history }));

      if (identity.role === "viewer") {
        const existing = localViewers.get(identity.viewerId);
        localViewers.set(identity.viewerId, {
          count: (existing?.count ?? 0) + 1,
          pseudo: identity.pseudo,
        });
        await state.touchPresence(identity.viewerId, identity.pseudo, PRESENCE_TTL_SECONDS);
      }
      await schedulePresence();
      log.info(
        { event: "chat.connected", role: identity.role, connectionId: conn.id },
        "Connexion chat ouverte",
      );

      return {
        receive: (raw) => receive(conn, raw),
        dispose: () => dispose(conn),
      };
    },

    async closeViewer(viewerId, code, reason) {
      await bus.publish({ kind: "close", target: { to: "viewer", viewerId }, code, reason });
    },

    async setStreamerSfuPresent(present) {
      if (present) {
        await state.touchStreamerLink(SFU_STREAMER_LINK_ID, SFU_STREAMER_LINK_TTL_SECONDS);
      } else {
        await state.removeStreamerLink(SFU_STREAMER_LINK_ID);
      }
      await schedulePresence();
    },

    refreshPresence: schedulePresence,

    notify,
  };
}
