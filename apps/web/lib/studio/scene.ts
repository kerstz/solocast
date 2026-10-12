/**
 * Scène du studio : file des demandes de parole et liste des speakers accordés par CE studio.
 * Pur. Le serveur reste l'autorité : une action n'entre dans la liste qu'après réponse 204.
 */

export type SceneActionKind = "grant" | "revoke" | "ban";

export interface SceneEntry {
  viewerId: string;
  pseudo: string;
}

export interface SceneFailure {
  viewerId: string;
  action: SceneActionKind;
}

export interface SceneState {
  /** Demandes reçues via stage:request, dans l'ordre d'arrivée. */
  requests: SceneEntry[];
  /** Speakers accordés pendant cette session du studio (liste locale, pas un état serveur). */
  speakers: SceneEntry[];
  /** Action en cours par viewer : un seul clic à la fois pour un même viewer. */
  busy: Readonly<Record<string, SceneActionKind>>;
  failure: SceneFailure | null;
}

export type SceneAction =
  | { type: "request_received"; viewerId: string; pseudo: string }
  | { type: "action_started"; viewerId: string; action: SceneActionKind }
  | { type: "grant_succeeded"; viewerId: string }
  | { type: "revoke_succeeded"; viewerId: string }
  | { type: "ban_succeeded"; viewerId: string }
  | { type: "action_failed"; viewerId: string; action: SceneActionKind }
  | { type: "failure_dismissed" };

export const INITIAL_SCENE_STATE: SceneState = {
  requests: [],
  speakers: [],
  busy: {},
  failure: null,
};

function withoutViewer(list: readonly SceneEntry[], viewerId: string): SceneEntry[] {
  return list.filter((entry) => entry.viewerId !== viewerId);
}

function withoutBusy(
  busy: Readonly<Record<string, SceneActionKind>>,
  viewerId: string,
): Record<string, SceneActionKind> {
  return Object.fromEntries(Object.entries(busy).filter(([id]) => id !== viewerId));
}

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case "request_received": {
      // Pas de doublon dans la file, et pas de demande pour un viewer déjà sur scène.
      const alreadyQueued = state.requests.some((r) => r.viewerId === action.viewerId);
      const onStage = state.speakers.some((s) => s.viewerId === action.viewerId);
      if (alreadyQueued || onStage) return state;
      return {
        ...state,
        requests: [...state.requests, { viewerId: action.viewerId, pseudo: action.pseudo }],
      };
    }

    case "action_started": {
      if (state.busy[action.viewerId] !== undefined) return state;
      return {
        ...state,
        busy: { ...state.busy, [action.viewerId]: action.action },
        failure: null,
      };
    }

    case "grant_succeeded": {
      // Le viewer passe de la file à la scène, avec le pseudo reçu dans la demande.
      const request = state.requests.find((r) => r.viewerId === action.viewerId);
      const busy = withoutBusy(state.busy, action.viewerId);
      if (!request) return { ...state, busy };
      return {
        ...state,
        busy,
        requests: withoutViewer(state.requests, action.viewerId),
        speakers: [...withoutViewer(state.speakers, action.viewerId), request],
      };
    }

    case "revoke_succeeded":
      return {
        ...state,
        busy: withoutBusy(state.busy, action.viewerId),
        speakers: withoutViewer(state.speakers, action.viewerId),
      };

    case "ban_succeeded":
      return {
        ...state,
        busy: withoutBusy(state.busy, action.viewerId),
        requests: withoutViewer(state.requests, action.viewerId),
        speakers: withoutViewer(state.speakers, action.viewerId),
      };

    case "action_failed":
      return {
        ...state,
        busy: withoutBusy(state.busy, action.viewerId),
        failure: { viewerId: action.viewerId, action: action.action },
      };

    case "failure_dismissed":
      return { ...state, failure: null };
  }
}

/** Donner est possible : pas d'action en cours pour ce viewer, plafond serveur non atteint. */
export function canGrant(state: SceneState, viewerId: string, capReached: boolean): boolean {
  return !capReached && state.busy[viewerId] === undefined;
}

/** Couper et Bannir ne dépendent que d'une action en cours pour ce viewer. */
export function canActOn(state: SceneState, viewerId: string): boolean {
  return state.busy[viewerId] === undefined;
}
