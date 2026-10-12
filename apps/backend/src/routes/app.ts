import { AppStatusSchema, SetShareRequestSchema } from "@solocast/shared";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from "fastify";
import { z } from "zod";
import type { AppControl } from "../app-control.js";
import { HttpError } from "../http/errors.js";
import { isLocalRequest } from "../http/local-host.js";
import type { RouteDeps } from "./shared-deps.js";

const EmptyBodySchema = z.strictObject({});

// Double verrou : cookie studio ET machine locale. L'adresse publique du tunnel ne peut donc ni
// lire l'état du partage ni arrêter l'application, même avec un cookie volé.
function requireLocal(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  if (!isLocalRequest(request.headers)) {
    done(new HttpError(403, "local_only", "Only available from the machine running SoloCast."));
    return;
  }
  done();
}

export function registerAppRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
  control: AppControl,
): void {
  const guard = [requireLocal, deps.authMiddleware.requireStreamer];

  app.get("/api/app/status", { preHandler: guard }, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return reply.send(AppStatusSchema.parse(control.status()));
  });

  app.post(
    "/api/app/share",
    { preHandler: guard, config: { rateLimit: deps.studioRateLimit } },
    async (request, reply) => {
      const { enabled } = SetShareRequestSchema.parse(request.body);
      await control.setShare(enabled);
      request.log.info({ event: "app.share", enabled }, "Share toggled");
      reply.header("Cache-Control", "no-store");
      return reply.send(AppStatusSchema.parse(control.status()));
    },
  );

  app.post("/api/app/quit", { preHandler: guard }, async (request, reply) => {
    EmptyBodySchema.parse(request.body ?? {});
    request.log.info({ event: "app.quit" }, "Quit requested from studio");
    // Réponse envoyée d'abord : l'arrêt part après la fin de cette requête.
    reply.code(204).send();
    setTimeout(() => {
      control.quit();
    }, 150);
    return reply;
  });
}
