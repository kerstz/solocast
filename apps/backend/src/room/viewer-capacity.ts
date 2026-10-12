import type { KeyValueStore } from "../state/key-value-store.js";

// Places viewer du salon : un membre par viewerId (plusieurs onglets = une seule place).
export const VIEWER_SLOT_KEY = "room:viewers:main";
// Durée d'une place sans renouvellement. Le hub la prolonge à chaque tick de présence :
// une place se libère donc ~1 min après la perte d'un onglet, même sans fermeture propre.
export const VIEWER_SLOT_TTL_SECONDS = 60;

export interface ViewerCapacity {
  /** Plafond configuré (MAX_VIEWERS), renvoyé tel quel dans presence:update. */
  readonly max: number;
  /** Prend ou prolonge la place du viewer. `false` = salon plein (le viewer n'en avait pas). */
  take(viewerId: string): Promise<boolean>;
  release(viewerId: string): Promise<void>;
  count(): Promise<number>;
}

/**
 * Plafond de viewers simultanés. S'appuie sur `takeSlot` du KeyValueStore : vérification et ajout
 * sont atomiques (script Lua côté Redis), donc deux instances backend ne peuvent pas dépasser le
 * plafond ensemble.
 */
export function createViewerCapacity(deps: {
  store: KeyValueStore;
  max: number;
  ttlSeconds?: number;
}): ViewerCapacity {
  const ttlSeconds = deps.ttlSeconds ?? VIEWER_SLOT_TTL_SECONDS;
  return {
    max: deps.max,
    take: (viewerId) => deps.store.takeSlot(VIEWER_SLOT_KEY, viewerId, ttlSeconds, deps.max),
    release: (viewerId) => deps.store.releaseSlot(VIEWER_SLOT_KEY, viewerId),
    count: () => deps.store.countSlots(VIEWER_SLOT_KEY),
  };
}
