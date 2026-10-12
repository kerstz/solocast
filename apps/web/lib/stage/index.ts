import { config } from "../config";
import { LiveKitStageMedia } from "./livekitMedia";
import { MockStageMedia } from "./mockMedia";
import type { StageMedia } from "./media";

let instance: StageMedia | null = null;

/** Média singleton côté navigateur. Le réel est importé dynamiquement (taille du bundle). */
export function getStageMedia(): StageMedia {
  if (!instance) {
    instance = config.mode === "mock" ? new MockStageMedia() : new LiveKitStageMedia();
  }
  return instance;
}
