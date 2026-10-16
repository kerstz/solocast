import type { Redis } from "ioredis";

// Etat éphémère (sessions streameur, bans viewer, grants de parole). Redis en production, mémoire dans les tests.
export interface KeyValueStore {
  // ttlSeconds = null : clé sans expiration (ex. bannissement permanent).
  set(key: string, value: string, ttlSeconds: number | null): Promise<void>;
  exists(key: string): Promise<boolean>;
  // Valeur d'une clé vivante, `null` si absente ou expirée.
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  // Clés vivantes commençant par `prefix` (SCAN côté Redis). Usage réservé à des préfixes bornés.
  listKeys(prefix: string): Promise<string[]>;
  // Ensemble borné de membres à expiration (places de speakers). ZSET côté Redis, score = expiration.
  // Retourne false si la capacité `max` est déjà atteinte (vérification + ajout atomiques).
  takeSlot(setKey: string, member: string, ttlSeconds: number, max: number): Promise<boolean>;
  releaseSlot(setKey: string, member: string): Promise<void>;
  // Vide l'ensemble entier (tous les membres). `delete` ne porte que sur les clés valeur.
  clearSlots(setKey: string): Promise<void>;
  hasSlot(setKey: string, member: string): Promise<boolean>;
  countSlots(setKey: string): Promise<number>;
}

const SCAN_BATCH_SIZE = 100;

// Élague les membres expirés, refuse si la capacité est atteinte, sinon ajoute (ou prolonge) le membre.
// Atomique : deux instances backend ne peuvent pas dépasser le plafond.
const TAKE_SLOT_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local expiresAt = tonumber(ARGV[3])
local max = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZSCORE', key, member) == false and redis.call('ZCARD', key) >= max then
  return 0
end
redis.call('ZADD', key, expiresAt, member)
return 1
`;

const COUNT_SLOTS_SCRIPT = `
local key = KEYS[1]
redis.call('ZREMRANGEBYSCORE', key, '-inf', tonumber(ARGV[1]))
return redis.call('ZCARD', key)
`;

const HAS_SLOT_SCRIPT = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if score == false or tonumber(score) <= tonumber(ARGV[2]) then
  return 0
end
return 1
`;

// Échappe les caractères joker de MATCH (glob Redis) pour qu'un préfixe reste littéral.
export const escapeGlob = (value: string): string =>
  value.replace(/[*?[\]\\]/g, (char) => `\\${char}`);

export function createRedisKeyValueStore(redis: Redis): KeyValueStore {
  return {
    async set(key, value, ttlSeconds) {
      if (ttlSeconds === null) {
        await redis.set(key, value);
        return;
      }
      await redis.set(key, value, "EX", ttlSeconds);
    },
    async exists(key) {
      return (await redis.exists(key)) === 1;
    },
    async get(key) {
      return redis.get(key);
    },
    async delete(key) {
      await redis.del(key);
    },
    async listKeys(prefix) {
      const keys: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(
          cursor,
          "MATCH",
          `${escapeGlob(prefix)}*`,
          "COUNT",
          SCAN_BATCH_SIZE,
        );
        keys.push(...batch);
        cursor = next;
      } while (cursor !== "0");
      return keys;
    },
    async takeSlot(setKey, member, ttlSeconds, max) {
      const now = Date.now();
      const result = await redis.eval(
        TAKE_SLOT_SCRIPT,
        1,
        setKey,
        member,
        now,
        now + ttlSeconds * 1000,
        max,
      );
      return Number(result) === 1;
    },
    async releaseSlot(setKey, member) {
      await redis.zrem(setKey, member);
    },
    async clearSlots(setKey) {
      await redis.del(setKey);
    },
    async hasSlot(setKey, member) {
      const result = await redis.eval(HAS_SLOT_SCRIPT, 1, setKey, member, Date.now());
      return Number(result) === 1;
    },
    async countSlots(setKey) {
      const result = await redis.eval(COUNT_SLOTS_SCRIPT, 1, setKey, Date.now());
      return Number(result);
    },
  };
}

/**
 * In-memory key/value store with TTLs. Used by the local single-process build (no Redis needed)
 * and by the unit tests. State is lost on restart, which is fine for sessions, bans and stage
 * grants in a local run; a multi-instance deployment must use the Redis store instead.
 */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  // Ensembles bornés à expiration (places de speakers) : member -> expiration (ms).
  private readonly slots = new Map<string, Map<string, number>>();

  set(key: string, value: string, ttlSeconds: number | null): Promise<void> {
    const expiresAt =
      ttlSeconds === null ? Number.POSITIVE_INFINITY : Date.now() + ttlSeconds * 1000;
    this.entries.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.live(key) !== undefined);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key) ?? null);
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  listKeys(prefix: string): Promise<string[]> {
    const keys = [...this.entries.keys()].filter(
      (key) => key.startsWith(prefix) && this.live(key) !== undefined,
    );
    return Promise.resolve(keys);
  }

  takeSlot(setKey: string, member: string, ttlSeconds: number, max: number): Promise<boolean> {
    const set = this.pruned(setKey);
    if (!set.has(member) && set.size >= max) {
      return Promise.resolve(false);
    }
    set.set(member, Date.now() + ttlSeconds * 1000);
    return Promise.resolve(true);
  }

  releaseSlot(setKey: string, member: string): Promise<void> {
    this.pruned(setKey).delete(member);
    return Promise.resolve();
  }

  clearSlots(setKey: string): Promise<void> {
    this.slots.delete(setKey);
    return Promise.resolve();
  }

  hasSlot(setKey: string, member: string): Promise<boolean> {
    return Promise.resolve(this.pruned(setKey).has(member));
  }

  countSlots(setKey: string): Promise<number> {
    return Promise.resolve(this.pruned(setKey).size);
  }

  private pruned(setKey: string): Map<string, number> {
    const set = this.slots.get(setKey) ?? new Map<string, number>();
    this.slots.set(setKey, set);
    const now = Date.now();
    for (const [member, expiresAt] of [...set]) {
      if (expiresAt <= now) {
        set.delete(member);
      }
    }
    return set;
  }

  private live(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
