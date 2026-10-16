import { BanRequestSchema, WS_CLOSE_CODES } from "@solocast/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { banKey } from "../auth/viewer-identity.js";
import { HttpError } from "../http/errors.js";
import type { RouteDeps } from "./shared-deps.js";

// Ban : écrit la clé AVANT toute coupure (un ban effectif même si le SFU échoue), ferme les WS,
// retire le droit de parole, puis coupe la publication et retire le participant du SFU.
export function registerModerationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { authMiddleware, store, hub, stage, livekit, ipBans } = deps;

  async function cutAndKick(log: FastifyBaseLogger, viewerId: string): Promise<string | undefined> {
    let sfuErrorName: string | undefined;
    try {
      await livekit.updateParticipant(viewerId, { canPublishAudio: false, canPublishVideo: false });
    } catch (error) {
      sfuErrorName = error instanceof Error ? error.name : "UnknownError";
    }
    try {
      await livekit.removeParticipant(viewerId);
    } catch (error) {
      sfuErrorName ??= error instanceof Error ? error.name : "UnknownError";
    }
    if (sfuErrorName !== undefined) {
      log.error({ event: "moderation.sfu_failed", errorName: sfuErrorName }, "Retrait SFU échoué");
    }
    return sfuErrorName;
  }

  app.post(
    "/api/moderation/ban",
    { preHandler: [authMiddleware.requireStreamer] },
    async (request, reply) => {
      const body = BanRequestSchema.parse(request.body);
      await store.set(banKey(body.viewerId), "1", body.ttlSeconds ?? null);
      // L'IP (empreinte HMAC) est bannie aussi, pour une durée bornée : un nouveau cookie ou une
      // fenêtre privée ne suffit plus à revenir.
      const ipBanned = await ipBans.banViewerIp(body.viewerId, body.ttlSeconds);
      await stage.revoke(body.viewerId);
      await hub.closeViewer(body.viewerId, WS_CLOSE_CODES.BANNED, "Access denied.");
      const sfuErrorName = await cutAndKick(request.log, body.viewerId);
      request.log.info(
        {
          event: "moderation.ban",
          permanent: body.ttlSeconds === undefined,
          hasReason: body.reason !== undefined,
          ipBanned,
        },
        "Viewer banni",
      );
      if (sfuErrorName !== undefined) {
        throw new HttpError(
          502,
          "sfu_unavailable",
          "Ban enregistré. Le SFU n'a pas confirmé le retrait du participant.",
        );
      }
      return reply.code(204).send();
    },
  );
}
