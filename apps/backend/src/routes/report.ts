import { ReportListResponseSchema, ReportRequestSchema } from "@solocast/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatServices } from "../chat/services.js";
import { HttpError } from "../http/errors.js";
import type { ReportQueue } from "../report/queue.js";
import type { RouteDeps } from "./shared-deps.js";

const REPORT_RATE_LIMIT = { max: 10, timeWindow: 60_000 } as const;

const DismissParamsSchema = z.strictObject({ id: z.string().min(1).max(64) });

// Signalement de message (DSA art. 16, à minima). Aucune donnée de signalement dans les logs :
// seulement un event et la catégorie.
export function registerReportRoutes(
  app: FastifyInstance,
  deps: Pick<RouteDeps, "authMiddleware">,
  chat: Pick<ChatServices, "state">,
  queue: ReportQueue,
): void {
  const { authMiddleware } = deps;

  app.post(
    "/api/report",
    { config: { rateLimit: REPORT_RATE_LIMIT }, preHandler: [authMiddleware.requireViewer] },
    async (request, reply) => {
      const body = ReportRequestSchema.parse(request.body);
      const reporterId = request.viewer?.viewerId;
      if (reporterId === undefined) {
        throw new Error("requireViewer succeeded without a viewer identity");
      }
      const history = await chat.state.recentHistory();
      const found = history.find((message) => message.id === body.messageId);
      const created = queue.add({
        messageId: body.messageId,
        reason: body.reason,
        details: body.details ?? null,
        reporterId,
        message:
          found === undefined
            ? null
            : { userId: found.userId, pseudo: found.pseudo, text: found.text },
      });
      request.log.info({ event: "report.received", reason: body.reason, created }, "Report");
      reply.header("Cache-Control", "no-store");
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/moderation/reports",
    { preHandler: [authMiddleware.requireStreamer] },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return reply.send(ReportListResponseSchema.parse({ reports: queue.list() }));
    },
  );

  app.post(
    "/api/moderation/reports/:id/dismiss",
    { preHandler: [authMiddleware.requireStreamer] },
    async (request, reply) => {
      const { id } = DismissParamsSchema.parse(request.params);
      if (!queue.dismiss(id)) {
        throw new HttpError(404, "not_found", "Report not found.");
      }
      request.log.info({ event: "report.dismissed" }, "Report dismissed");
      reply.header("Cache-Control", "no-store");
      return reply.code(204).send();
    },
  );
}
