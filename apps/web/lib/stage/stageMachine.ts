import type { TokenResponse } from "@solocast/shared";

/**
 * Machine d'état de la parole (côté viewer). Pure : aucun effet de bord.
 * Règle de sécurité : on ne passe jamais en publication sans token dont canPublishAudio=true.
 * L'antenne n'est ouverte que par stage:granted (serveur) suivi d'un token serveur.
 */
export type StageErrorReason =
  | "chat_unavailable"
  | "token_failed"
  | "not_granted"
  | "mic_denied"
  | "media_failed"
  | "leave_failed";

export type StageState =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "minting" }
  | { phase: "connecting" }
  | { phase: "publishing" }
  | { phase: "on_air" }
  | { phase: "stopping" }
  | { phase: "error"; reason: StageErrorReason };

export type StageEvent =
  | { type: "REQUEST" }
  | { type: "REQUEST_FAILED" }
  | { type: "GRANTED" }
  | { type: "REVOKED" }
  | { type: "LEAVE" }
  | { type: "LEAVE_FAILED" }
  | { type: "TOKEN_OK"; token: TokenResponse }
  | { type: "TOKEN_FAILED" }
  | { type: "CONNECTED" }
  | { type: "MIC_ON" }
  | { type: "MEDIA_FAILED"; reason: "mic_denied" | "media_failed" }
  | { type: "DISCONNECTED" }
  | { type: "DISMISS" };

export const INITIAL_STAGE_STATE: StageState = { phase: "idle" };

export function stageReducer(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case "REQUEST":
      return state.phase === "idle" || state.phase === "error" ? { phase: "requesting" } : state;

    case "REQUEST_FAILED":
      return state.phase === "requesting" ? { phase: "error", reason: "chat_unavailable" } : state;

    case "GRANTED":
      // Accordé sans demande (initiative du streameur), après demande, ou re-accordé pendant
      // qu'une sortie de scène se termine : on repart sur un nouveau token.
      return state.phase === "idle" ||
        state.phase === "requesting" ||
        state.phase === "error" ||
        state.phase === "stopping"
        ? { phase: "minting" }
        : state;

    case "REVOKED":
      // Stopping = fin confirmée par le serveur (stage:revoked après un LEAVE) : libre.
      if (state.phase === "stopping") return { phase: "idle" };
      // Retrait serveur : coupe tout, y compris une demande en attente.
      if (isActive(state)) return { phase: "stopping" };
      return { phase: "idle" };

    case "LEAVE":
      // Le viewer quitte la scène : micro coupé tout de suite, mais l'état reste « stopping »
      // jusqu'à stage:revoked (confirmation serveur), jamais sur un simple retour local.
      if (isActive(state)) return { phase: "stopping" };
      return state;

    case "LEAVE_FAILED":
      // stage:leave non envoyé (chat déconnecté) : l'erreur reste visible jusqu'à DISMISS.
      return state.phase === "stopping" ? { phase: "error", reason: "leave_failed" } : state;

    case "TOKEN_OK":
      if (state.phase !== "minting") return state;
      return event.token.canPublishAudio
        ? { phase: "connecting" }
        : { phase: "error", reason: "not_granted" };

    case "TOKEN_FAILED":
      return state.phase === "minting" ? { phase: "error", reason: "token_failed" } : state;

    case "CONNECTED":
      return state.phase === "connecting" ? { phase: "publishing" } : state;

    case "MIC_ON":
      return state.phase === "publishing" ? { phase: "on_air" } : state;

    case "MEDIA_FAILED":
      return isActive(state) && state.phase !== "stopping"
        ? { phase: "error", reason: event.reason }
        : state;

    case "DISCONNECTED":
      // Déconnexion attendue (stopping) ou inattendue (on_air) : retour au lecteur HLS.
      // Depuis error, on garde le message affiché jusqu'à DISMISS.
      if (state.phase === "error") return state;
      if (isActive(state) || state.phase === "stopping") return { phase: "idle" };
      return state;

    case "DISMISS":
      return state.phase === "error" ? { phase: "idle" } : state;
  }
}

/** Phases où une session SFU est ouverte ou en cours d'ouverture. */
export function isActive(state: StageState): boolean {
  return (
    state.phase === "minting" ||
    state.phase === "connecting" ||
    state.phase === "publishing" ||
    state.phase === "on_air" ||
    state.phase === "stopping"
  );
}

export function isOnAir(state: StageState): boolean {
  return state.phase === "on_air";
}

/** Stream audio is muted as soon as a microphone session exists (prevents echo). */
export function mutesStreamAudio(state: StageState): boolean {
  return (
    state.phase === "connecting" ||
    state.phase === "publishing" ||
    state.phase === "on_air" ||
    state.phase === "stopping"
  );
}

export function canRequest(state: StageState): boolean {
  return state.phase === "idle" || state.phase === "error";
}
