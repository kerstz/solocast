import type { TokenResponse } from "@solocast/shared";

export interface StageMediaHandlers {
  /** Appelé quand la session SFU se ferme (révocation serveur, réseau, fin). */
  onDisconnected: () => void;
}

/**
 * Média de la scène : WebRTC via LiveKit, audio seul. Jamais ouvert pour un viewer passif.
 * Implémentations : livekitMedia (réel, chargé à la demande) et mockMedia (dev/e2e).
 */
export interface StageMedia {
  /** Se connecte au SFU avec le token serveur. Ne publie rien. */
  connect(token: TokenResponse, handlers: StageMediaHandlers): Promise<void>;
  /** Active le micro (publication audio). Lève StageMediaError('mic_denied') si refusé. */
  enableMicrophone(): Promise<void>;
  /** Coupe le micro et ferme la session. Idempotent. */
  disconnect(): Promise<void>;
}

export class StageMediaError extends Error {
  constructor(readonly code: "mic_denied" | "failed") {
    super(code);
    this.name = "StageMediaError";
  }
}
