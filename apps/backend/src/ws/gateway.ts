import websocket from "@fastify/websocket";
import { WS_CLOSE_CODES, WS_PATH } from "@solocast/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData, WebSocket } from "ws";
import type { ChatIdentity, ChatConnection, ChatHub } from "../chat/hub.js";
import type { StreamerAuth } from "../auth/streamer-auth.js";
import { banKey, type ViewerIdentityService } from "../auth/viewer-identity.js";
import type { ClientIpResolver } from "../http/client-ip.js";
import { HttpError } from "../http/errors.js";
import { isLoopbackAddress } from "../http/local-host.js";
import type { IpBans } from "../moderation/ip-ban.js";
import type { ViewerCapacity } from "../room/viewer-capacity.js";
import type { KeyValueStore } from "../state/key-value-store.js";

declare module "fastify" {
  interface FastifyRequest {
    chatIdentity: ChatIdentity | undefined;
    chatClientIp: string | undefined;
  }
}

export interface ChatGatewayDeps {
  hub: ChatHub;
  viewers: ViewerIdentityService;
  streamerAuth: StreamerAuth;
  // Plafond de viewers simultanés : la place est prise juste après l'upgrade.
  capacity: ViewerCapacity;
  store: KeyValueStore;
  cookies: { streamerName: string; viewerName: string };
  // Origines autorisées pour l'upgrade (CORS_ORIGIN normalisé).
  allowedOrigins: ReadonlySet<string>;
  maxPayloadBytes: number;
  clientIp: ClientIpResolver;
  ipBans: IpBans;
  // Sockets viewer simultanées par IP (cette machine n'est pas plafonnée : studio, onglets locaux).
  maxConnectionsPerIp: number;
  // Ping périodique : une socket qui n'a pas répondu au ping précédent est coupée (place libérée).
  heartbeatIntervalMs: number;
}

const TOO_MANY_CONNECTIONS_CLOSE_CODE = 1008;

/** Compteur de sockets par IP, local au processus (chaque instance plafonne ses propres sockets). */
function createConnectionCounter(max: number) {
  const counts = new Map<string, number>();
  return {
    full: (ip: string): boolean => (counts.get(ip) ?? 0) >= max,
    /** Ajoute une socket ; `false` (et rien n'est compté) si le plafond est déjà atteint. */
    acquire(ip: string): boolean {
      const current = counts.get(ip) ?? 0;
      if (current >= max) return false;
      counts.set(ip, current + 1);
      return true;
    },
    release(ip: string): void {
      const current = counts.get(ip) ?? 0;
      if (current <= 1) counts.delete(ip);
      else counts.set(ip, current - 1);
    },
  };
}

const limitedIp = (ip: string): boolean => ip !== "" && !isLoopbackAddress(ip);

// Authentification AVANT upgrade : origine, puis cookie streameur, puis cookie viewer.
// Toute erreur part en réponse HTTP (401/403) sur la socket brute : aucune connexion WS n'est créée.
async function authenticate(
  request: FastifyRequest,
  deps: ChatGatewayDeps,
  connections: ReturnType<typeof createConnectionCounter>,
): Promise<ChatIdentity> {
  const origin = request.headers.origin;
  if (origin === undefined || !deps.allowedOrigins.has(origin)) {
    throw new HttpError(403, "origin_not_allowed", "Origin not allowed.");
  }
  const studio = await deps.streamerAuth.session(request.cookies[deps.cookies.streamerName]);
  if (studio !== null) {
    // Le streameur ne consomme jamais une place viewer : le plafond ne doit pas l'exclure.
    return { role: "streamer", tokenId: studio.tokenId };
  }
  const identity = await deps.viewers.resolve(request.cookies[deps.cookies.viewerName]);
  if (identity === null) {
    throw new HttpError(401, "identity_required", "Identity required.");
  }
  const ip = deps.clientIp(request);
  if ((await deps.store.exists(banKey(identity.viewerId))) || (await deps.ipBans.isBanned(ip))) {
    throw new HttpError(403, "viewer_banned", "Access denied.");
  }
  // Refus rapide avant upgrade ; le comptage qui fait foi a lieu à l'ouverture de la socket.
  if (limitedIp(ip) && connections.full(ip)) {
    throw new HttpError(429, "too_many_connections", "Too many connections from this address.");
  }
  await deps.ipBans.remember(identity.viewerId, ip);
  request.chatClientIp = ip;
  return {
    role: "viewer",
    viewerId: identity.viewerId,
    pseudo: identity.pseudo,
    color: identity.color,
  };
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

export async function registerChatGateway(
  app: FastifyInstance,
  deps: ChatGatewayDeps,
): Promise<void> {
  await app.register(websocket, { options: { maxPayload: deps.maxPayloadBytes } });
  app.decorateRequest("chatIdentity", undefined);
  app.decorateRequest("chatClientIp", undefined);
  const connections = createConnectionCounter(deps.maxConnectionsPerIp);

  // Heartbeat : chaque socket doit répondre (pong) entre deux pings, sinon elle est coupée. Une
  // connexion à moitié ouverte (mobile sans réseau) libère ainsi sa place en moins de deux
  // intervalles au lieu d'attendre le timeout TCP.
  const alive = new Map<WebSocket, boolean>();
  const heartbeat = setInterval(() => {
    for (const [socket, answered] of alive) {
      if (!answered) {
        alive.delete(socket);
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, deps.heartbeatIntervalMs);
  heartbeat.unref();
  app.addHook("onClose", (_instance, done) => {
    clearInterval(heartbeat);
    done();
  });

  const attachChatIdentity = async (request: FastifyRequest): Promise<void> => {
    request.chatIdentity = await authenticate(request, deps, connections);
  };

  app.get(
    WS_PATH,
    {
      websocket: true,
      preValidation: [attachChatIdentity],
    },
    (connection, request) => {
      const { socket } = connection;
      const identity = request.chatIdentity;
      if (identity === undefined) {
        socket.close(1011, "Internal error.");
        return;
      }
      const ip = request.chatClientIp ?? "";
      if (identity.role === "viewer" && limitedIp(ip)) {
        if (!connections.acquire(ip)) {
          request.log.info({ event: "ws.too_many_connections" }, "Connexion refusée : plafond IP");
          socket.close(TOO_MANY_CONNECTIONS_CLOSE_CODE, "Too many connections.");
          return;
        }
        socket.once("close", () => {
          connections.release(ip);
        });
      }
      alive.set(socket, true);
      socket.on("pong", () => {
        if (alive.has(socket)) alive.set(socket, true);
      });
      socket.once("close", () => {
        alive.delete(socket);
      });
      // Plafond de viewers : la place est prise après l'upgrade, pour que le client reçoive un
      // code de fermeture explicite (le navigateur ne lui donne pas le statut HTTP d'un upgrade raté).
      // `null` = salon plein : aucune connexion n'est ouverte, rien n'est à traiter ensuite.
      const opened: Promise<ChatConnection | null> = (async () => {
        if (identity.role === "viewer" && !(await deps.capacity.take(identity.viewerId))) {
          request.log.info({ event: "ws.room_full" }, "Connexion refusée : salon plein");
          socket.close(WS_CLOSE_CODES.ROOM_FULL, "Room is full.");
          return null;
        }
        return deps.hub.open(socket, identity);
      })();
      // Messages traités un par un, dans l'ordre d'arrivée (rate-limit et flood sérialisés).
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (task: (conn: ChatConnection) => Promise<void>): void => {
        chain = chain
          .then(async () => {
            const conn = await opened;
            if (conn !== null) await task(conn);
          })
          .catch((error: unknown) => {
            const errorName = error instanceof Error ? error.name : "UnknownError";
            request.log.error({ event: "ws.task_failed", errorName }, "Traitement WS échoué");
          });
      };

      opened.catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        request.log.error({ event: "ws.open_failed", errorName }, "Ouverture WS échouée");
        socket.close(1011, "Internal error.");
      });
      socket.on("message", (data: RawData) => {
        enqueue((conn) => conn.receive(rawDataToString(data)));
      });
      socket.on("close", () => {
        enqueue((conn) => conn.dispose());
      });
    },
  );
}
