import type { FastifyBaseLogger } from "fastify";
import { SERVER_EVENTS } from "@solocast/shared";
import type { LiveKitGateway } from "../livekit/gateway.js";
import type { StageNotification } from "./stage-notifier.js";
import type { StageRegistry } from "./stage-registry.js";

export interface SpeakerRevokerDeps {
  stage: StageRegistry;
  livekit: LiveKitGateway;
  notify: (notification: StageNotification) => Promise<void>;
  log: FastifyBaseLogger;
}

// Retrait de parole (stage:leave et POST /api/stage/revoke) : Redis d'abord (fail-safe), puis
// coupure SFU, puis stage:revoked. Retourne le nom de l'erreur SFU si la coupure n'a pas été
// confirmée (le droit est retiré dans tous les cas), undefined sinon. Ne lève pas : l'appelant
// décide quoi en faire (502 côté HTTP, log seul côté WebSocket).
export function createSpeakerRevoker(
  deps: SpeakerRevokerDeps,
): (viewerId: string) => Promise<string | undefined> {
  const { stage, livekit, notify, log } = deps;
  return async (viewerId) => {
    await stage.revoke(viewerId);
    let sfuErrorName: string | undefined;
    try {
      await livekit.updateParticipant(viewerId, { canPublishAudio: false, canPublishVideo: false });
    } catch (error) {
      sfuErrorName = error instanceof Error ? error.name : "UnknownError";
      log.error(
        { event: "stage.revoke.sfu_failed", errorName: sfuErrorName },
        "Coupure SFU échouée",
      );
    }
    await notify({ event: SERVER_EVENTS.STAGE_REVOKED, viewerId });
    return sfuErrorName;
  };
}
