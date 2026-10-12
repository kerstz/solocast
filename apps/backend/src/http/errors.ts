import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

// Erreur métier avec code stable et message public (en français, sans donnée d'entrée réfléchie).
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function describeValidationIssues(error: ZodError): string {
  const fields = new Set(
    error.issues.map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "corps")),
  );
  return `Requête invalide : ${[...fields].join(", ")}.`;
}

const CLIENT_ERROR_MESSAGES: Record<number, { code: string; message: string }> = {
  413: { code: "payload_too_large", message: "Request body too large." },
  415: { code: "unsupported_media_type", message: "Unsupported content type." },
  // Rate-limit (@fastify/rate-limit) : code explicite plutôt que « bad_request ».
  429: { code: "rate_limited", message: "Too many requests, try again later." },
};

export function registerErrorHandlers(
  app: FastifyInstance,
  options: { htmlNotFound?: boolean } = {},
): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({ error: "validation_error", message: describeValidationIssues(error) });
    }
    if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      const mapped = CLIENT_ERROR_MESSAGES[error.statusCode] ?? {
        code: "bad_request",
        message: "Invalid request.",
      };
      return reply.code(error.statusCode).send({ error: mapped.code, message: mapped.message });
    }
    request.log.error({ err: error }, "Erreur interne");
    return reply.code(500).send({ error: "internal_error", message: "Internal error." });
  });

  app.setNotFoundHandler((request, reply) => {
    // Front exporté : une page inconnue (hors /api) reçoit la page 404 du site, pas du JSON.
    if (
      options.htmlNotFound === true &&
      request.method === "GET" &&
      !request.url.startsWith("/api/")
    ) {
      return reply.code(404).sendFile("404.html");
    }
    return reply.code(404).send({ error: "not_found", message: "Route not found." });
  });
}
