import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { STREAMER_IDENTITY } from "../livekit/grants.js";
import type { ChatHub } from "../chat/hub.js";

// Limite du corps (les webhooks LiveKit dépassent le défaut global de 4 Ko avec les tracks).
export const LIVEKIT_WEBHOOK_BODY_LIMIT = 64 * 1024;

export interface LiveKitWebhookEvent {
  event: string;
  participant?: { identity?: string; permission?: { canPublish?: boolean } };
}

// Port de vérification : WebhookReceiver de livekit-server-sdk en production.
export interface LiveKitWebhookVerifier {
  receive(body: string, authHeader?: string): Promise<LiveKitWebhookEvent>;
}

export interface LiveKitWebhookDeps {
  verifier: LiveKitWebhookVerifier;
  hub: ChatHub;
  log: FastifyBaseLogger;
  // Contrôle d'un viewer qui vient de rejoindre le SFU (jeton LiveKit encore valide après un
  // ban ou un retrait de parole). Absent : aucun contrôle.
  guardViewerJoin?: (identity: string, canPublish: boolean | undefined) => Promise<void>;
}

export function registerLiveKitWebhookRoutes(app: FastifyInstance, deps: LiveKitWebhookDeps): void {
  // Corps brut requis pour la signature : parser dédié, encapsulé à ce seul scope.
  app.register((scope, _options, done) => {
    scope.addContentTypeParser(
      ["application/webhook+json", "application/json"],
      { parseAs: "string" },
      (_request, body, parseDone) => {
        parseDone(null, body);
      },
    );

    scope.post(
      "/webhooks/livekit",
      { bodyLimit: LIVEKIT_WEBHOOK_BODY_LIMIT },
      async (request, reply) => {
        const body = typeof request.body === "string" ? request.body : "";
        let event: LiveKitWebhookEvent;
        try {
          event = await deps.verifier.receive(body, request.headers.authorization);
        } catch {
          // Signature absente, invalide ou corps non conforme : rejet générique, rien n'est journalisé du corps.
          request.log.warn({ event: "webhook.rejected" }, "Webhook LiveKit rejeté");
          return reply
            .code(401)
            .send({ error: "invalid_signature", message: "Signature invalide." });
        }
        await handleEvent(event, deps, request.log);
        return reply.code(200).send();
      },
    );
    done();
  });
}

async function handleEvent(
  event: LiveKitWebhookEvent,
  deps: LiveKitWebhookDeps,
  log: FastifyBaseLogger,
): Promise<void> {
  const identity = event.participant?.identity ?? "";
  switch (event.event) {
    case "participant_joined":
    case "participant_left": {
      const joined = event.event === "participant_joined";
      log.info(
        { event: joined ? "sfu.participant_joined" : "sfu.participant_left", identity },
        "Participant SFU",
      );
      if (identity === STREAMER_IDENTITY) {
        await deps.hub.setStreamerSfuPresent(joined);
      } else {
        if (joined) {
          await guardJoin(deps, identity, event.participant?.permission?.canPublish, log);
        }
        // Speakers et présence renvoyés aux clients après tout changement de participant.
        await deps.hub.refreshPresence();
      }
      return;
    }
    default:
      return;
  }
}

// Un jeton LiveKit vit LIVEKIT_TOKEN_TTL_SECONDS et ne se révoque pas : un viewer banni, ou dont
// la parole a été retirée (ou accordée entre-temps), pourrait rejoindre le SFU avec l'ancien. Le webhook est le seul point
// où ce rejoin est visible : on y rejoue le ban et le droit de parole. Un échec du SFU est
// journalisé sans faire échouer le webhook (LiveKit réessaierait pour rien).
async function guardJoin(
  deps: LiveKitWebhookDeps,
  identity: string,
  canPublish: boolean | undefined,
  log: FastifyBaseLogger,
): Promise<void> {
  if (deps.guardViewerJoin === undefined) return;
  try {
    await deps.guardViewerJoin(identity, canPublish);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    log.error({ event: "sfu.join_guard_failed", errorName }, "Contrôle du rejoin SFU échoué");
  }
}
