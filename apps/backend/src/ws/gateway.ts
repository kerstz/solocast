import websocket from "@fastify/websocket";
import { WS_CLOSE_CODES, WS_PATH } from "@solocast/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RawData } from "ws";
import type { ChatIdentity, ChatConnection, ChatHub } from "../chat/hub.js";
import type { StreamerAuth } from "../auth/streamer-auth.js";
import { banKey, type ViewerIdentityService } from "../auth/viewer-identity.js";
import { HttpError } from "../http/errors.js";
import type { ViewerCapacity } from "../room/viewer-capacity.js";
import type { KeyValueStore } from "../state/key-value-store.js";

declare module "fastify" {
  interface FastifyRequest {
    chatIdentity: ChatIdentity | undefined;
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
}

// Authentification AVANT upgrade : origine, puis cookie streameur, puis cookie viewer.
// Toute erreur part en réponse HTTP (401/403) sur la socket brute : aucune connexion WS n'est créée.
async function authenticate(request: FastifyRequest, deps: ChatGatewayDeps): Promise<ChatIdentity> {
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
  if (await deps.store.exists(banKey(identity.viewerId))) {
    throw new HttpError(403, "viewer_banned", "Access denied.");
  }
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

  const attachChatIdentity = async (request: FastifyRequest): Promise<void> => {
    request.chatIdentity = await authenticate(request, deps);
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
