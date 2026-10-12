import { CLIENT_EVENTS, SERVER_EVENTS, StageViewerRequestSchema } from "@solocast/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import type { RouteDeps } from "./shared-deps.js";

const EmptyBodySchema = z.strictObject({});

// Anti-spam des demandes de parole (par IP, en mémoire du rate-limit Fastify).
export const STAGE_REQUEST_RATE_LIMIT = { max: 5, timeWindow: 60_000 };

export function registerStageRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { authMiddleware, stage, stageNotifier, viewers, revokeSpeaker } = deps;

  app.post(
    "/api/stage/grant",
    { preHandler: [authMiddleware.requireStreamer] },
    async (request, reply) => {
      const body = StageViewerRequestSchema.parse(request.body);
      await viewers.assertNotBanned(body.viewerId);
      await stage.grant(body.viewerId);
      await stageNotifier.notify({ event: SERVER_EVENTS.STAGE_GRANTED, viewerId: body.viewerId });
      request.log.info({ event: "stage.granted" }, "Parole accordée");
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/stage/revoke",
    { preHandler: [authMiddleware.requireStreamer] },
    async (request, reply) => {
      const body = StageViewerRequestSchema.parse(request.body);
      // Même chemin que stage:leave : droit retiré en premier (fail-safe), puis coupure SFU.
      const sfuErrorName = await revokeSpeaker(body.viewerId);
      if (sfuErrorName !== undefined) {
        throw new HttpError(
          502,
          "sfu_unavailable",
          "The SFU did not confirm the mute. The speaking right was removed server-side.",
        );
      }
      request.log.info({ event: "stage.revoked" }, "Parole révoquée");
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/stage/request",
    {
      preHandler: [authMiddleware.requireViewer],
      config: { rateLimit: STAGE_REQUEST_RATE_LIMIT },
    },
    async (request, reply) => {
      EmptyBodySchema.parse(request.body ?? {});
      const viewer = request.viewer;
      if (viewer === undefined) {
        throw new HttpError(401, "viewer_identity_required", "Viewer identity required.");
      }
      // Sans pseudo, la demande n'est pas transmissible au streameur : échec explicite
      // plutôt qu'un 204 suivi d'une notification silencieusement abandonnée.
      if (viewer.pseudo === null) {
        throw new HttpError(400, "pseudo_required", "Pick a username before asking to speak.");
      }
      // Ne modifie aucun droit : simple demande transmise au streameur.
      await stageNotifier.notify({
        event: CLIENT_EVENTS.STAGE_REQUEST,
        viewerId: viewer.viewerId,
        pseudo: viewer.pseudo,
      });
      request.log.info({ event: "stage.requested" }, "Demande de parole reçue");
      return reply.code(204).send();
    },
  );
}
