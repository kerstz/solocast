import { TokenResponseSchema } from "@solocast/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { viewerMediaGrant, streamerMediaGrant, type MediaGrant } from "../livekit/grants.js";
import { HttpError } from "../http/errors.js";
import type { RouteDeps } from "./shared-deps.js";

const EmptyBodySchema = z.strictObject({});

// No client field can raise a permission: strict body, grants decided server-side (store).
//
// Local build: every viewer watches over WebRTC, so a passive viewer does get a token — but a
// subscribe-only one (canPublish false). The microphone is added only when the streamer granted
// the stage, and that grant lives in the store, never in the request.
export function registerTokenRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { streamerAuth, authMiddleware, stage, livekit, cookies, capacity } = deps;

  async function grantFor(
    request: FastifyRequest,
  ): Promise<{ grant: MediaGrant; role: "streamer" | "viewer" }> {
    if (await streamerAuth.isAuthorized(request.cookies[cookies.streamerName])) {
      return { grant: streamerMediaGrant(), role: "streamer" };
    }
    await authMiddleware.requireViewer(request);
    const viewerId = request.viewer?.viewerId;
    if (viewerId === undefined) {
      throw new Error("requireViewer succeeded without a viewer identity");
    }
    // Même plafond que le chat : sans place, pas de session SFU (le flux coûte de l'egress).
    if (!(await capacity.take(viewerId))) {
      throw new HttpError(503, "room_full", "Room is full.");
    }
    return { grant: viewerMediaGrant(viewerId, await stage.isSpeaker(viewerId)), role: "viewer" };
  }

  app.post("/api/token", { config: { rateLimit: deps.tokenRateLimit } }, async (request, reply) => {
    EmptyBodySchema.parse(request.body ?? {});
    const { grant, role } = await grantFor(request);
    // La room n'est jamais créée automatiquement (room.auto_create = false côté SFU) :
    // sans cet appel, le jeton serait valide mais la connexion refusée par le SFU.
    try {
      await livekit.ensureRoom();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      request.log.error({ event: "token.room_failed", errorName }, "Création de la room échouée");
      throw new HttpError(502, "sfu_unavailable", "The SFU is unreachable. Try again shortly.");
    }
    const token = await livekit.createToken(grant);

    request.log.info(
      { event: "token.issued", role, canPublishAudio: grant.canPublishAudio },
      "LiveKit token issued",
    );
    reply.header("Cache-Control", "no-store");
    return reply.send(
      TokenResponseSchema.parse({
        livekitUrl: deps.livekitPublicWsUrl,
        token,
        identity: grant.identity,
        canPublishVideo: grant.canPublishVideo,
        canPublishAudio: grant.canPublishAudio,
      }),
    );
  });
}
