import { HttpError } from "../http/errors.js";
import type { KeyValueStore } from "../state/key-value-store.js";

// Grants de parole : un ensemble borné de membres à expiration (ZSET Redis), source de vérité serveur.
// L'ajout est atomique côté Redis : le plafond tient même avec plusieurs instances backend.
export const stageSetKey = (roomName: string): string => `stage:${roomName}`;

export interface StageRegistry {
  isSpeaker(viewerId: string): Promise<boolean>;
  // 409 si le plafond MAX_SPEAKERS est atteint. Ré-accorder un speaker existant ne compte pas double.
  grant(viewerId: string): Promise<void>;
  revoke(viewerId: string): Promise<void>;
  // Nombre de speakers actifs (jauge « x/8 »). O(1) côté Redis après élagage.
  count(): Promise<number>;
}

export interface StageRegistryDeps {
  store: KeyValueStore;
  roomName: string;
  maxSpeakers: number;
  ttlSeconds: number;
}

export function createStageRegistry(deps: StageRegistryDeps): StageRegistry {
  const { store, roomName, maxSpeakers, ttlSeconds } = deps;
  const setKey = stageSetKey(roomName);

  return {
    isSpeaker(viewerId) {
      return store.hasSlot(setKey, viewerId);
    },

    async grant(viewerId) {
      const taken = await store.takeSlot(setKey, viewerId, ttlSeconds, maxSpeakers);
      if (!taken) {
        throw new HttpError(409, "speakers_full", "Speaker limit reached.");
      }
    },

    revoke(viewerId) {
      return store.releaseSlot(setKey, viewerId);
    },

    count() {
      return store.countSlots(setKey);
    },
  };
}
