import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

// Fenêtre glissante : hit() retourne true si l'action est acceptée. Un rejet n'entre pas dans la fenêtre.
export interface SlidingWindowLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

// Fréquence du balayage des fenêtres mortes dans l'implémentation mémoire.
const PURGE_EVERY_HITS = 500;

export function createMemorySlidingWindowLimiter(): SlidingWindowLimiter {
  const windows = new Map<string, number[]>();
  let hits = 0;
  return {
    hit(key, limit, windowMs) {
      const now = Date.now();
      // Balayage amorti (1 fois sur PURGE_EVERY_HITS) : sans lui, la Map garderait une entrée
      // par identité à vie. Coût réparti au lieu d'un O(N) à chaque message.
      hits += 1;
      if (hits % PURGE_EVERY_HITS === 0) {
        for (const [other, timestamps] of windows) {
          const last = timestamps.at(-1);
          if (last === undefined || last <= now - windowMs) {
            windows.delete(other);
          }
        }
      }
      const recent = (windows.get(key) ?? []).filter((ts) => ts > now - windowMs);
      if (recent.length >= limit) {
        windows.set(key, recent);
        return Promise.resolve(false);
      }
      recent.push(now);
      windows.set(key, recent);
      return Promise.resolve(true);
    },
  };
}

// Script Lua : l'élagage, le comptage et l'ajout sont atomiques (pas de dépassement sous concurrence).
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
if redis.call('ZCARD', key) >= limit then
  redis.call('PEXPIRE', key, windowMs)
  return 0
end
redis.call('ZADD', key, now, ARGV[4])
redis.call('PEXPIRE', key, windowMs)
return 1
`;

export function createRedisSlidingWindowLimiter(redis: Redis): SlidingWindowLimiter {
  return {
    async hit(key, limit, windowMs) {
      const result = await redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        key,
        Date.now(),
        windowMs,
        limit,
        randomUUID(),
      );
      return Number(result) === 1;
    },
  };
}
