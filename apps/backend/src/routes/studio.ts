import { IngestResponseSchema } from "@solocast/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STREAMER_SESSION_TTL_SECONDS } from "../auth/streamer-auth.js";
import { sessionCookieOptions } from "../http/cookies.js";
import { HttpError } from "../http/errors.js";
import type { RouteDeps } from "./shared-deps.js";

const EmptyBodySchema = z.strictObject({});

/**
 * Routes de session studio. Aucune clé d'entrée : POST /api/studio/open pose le cookie studio et
 * prend la place (le bail du détenteur précédent est écarté) ; POST /api/studio/close rend cookie
 * et bail. Le cookie reste la seule autorité des routes streameur (grant / revoke / ban / ingest).
 */
export function registerStudioRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { streamerAuth, cookies } = deps;

  app.post(
    "/api/studio/open",
    { config: { rateLimit: deps.studioRateLimit } },
    async (request, reply) => {
      EmptyBodySchema.parse(request.body ?? {});
      const token = await streamerAuth.open(request.cookies[cookies.streamerName]);
      reply.setCookie(
        cookies.streamerName,
        token,
        sessionCookieOptions(cookies.secure, STREAMER_SESSION_TTL_SECONDS),
      );
      request.log.info({ event: "studio.open" }, "Studio session opened");
      return reply.code(204).send();
    },
  );

  app.post("/api/studio/close", async (request, reply) => {
    EmptyBodySchema.parse(request.body ?? {});
    await streamerAuth.close(request.cookies[cookies.streamerName]);
    reply.clearCookie(cookies.streamerName, sessionCookieOptions(cookies.secure));
    request.log.info({ event: "studio.close" }, "Studio session closed");
    return reply.code(204).send();
  });

  // Ingest OBS : URL RTMP + clé de flux de l'Ingress LiveKit. Réservé au streameur (cookie studio),
  // jamais mis en cache : la clé de flux vaut droit de publier sur la room.
  app.post(
    "/api/studio/ingest",
    { preHandler: [deps.authMiddleware.requireStreamer], config: { rateLimit: deps.tokenRateLimit } },
    async (request, reply) => {
      EmptyBodySchema.parse(request.body ?? {});
      const ingest = await deps.livekit.ensureIngress();
      if (ingest === null) {
        throw new HttpError(
          502,
          "ingress_unavailable",
          "The LiveKit Ingress service did not answer. Start it (docker compose up -d ingress).",
        );
      }
      request.log.info({ event: "studio.ingest" }, "Ingest OBS fourni");
      reply.header("Cache-Control", "no-store");
      return reply.send(IngestResponseSchema.parse(ingest));
    },
  );
}
