import { ChatMessageSchema, type ChatMessage } from "@solocast/shared";
import type { Redis } from "ioredis";

// État partagé entre instances : historique capé, présence des viewers, liens streameur (WS / SFU).
export interface PresenceEntry {
  viewerId: string;
  pseudo: string | null;
}

export interface ChatState {
  appendHistory(message: ChatMessage): Promise<void>;
  // Du plus ancien au plus récent.
  recentHistory(): Promise<ChatMessage[]>;
  touchPresence(viewerId: string, pseudo: string | null, ttlSeconds: number): Promise<void>;
  removePresence(viewerId: string): Promise<void>;
  listPresence(): Promise<PresenceEntry[]>;
  // Un lien = une connexion WS du streameur (id de connexion) ou sa présence SFU ("sfu").
  touchStreamerLink(linkId: string, ttlSeconds: number): Promise<void>;
  removeStreamerLink(linkId: string): Promise<void>;
  hasStreamerLink(linkId: string): Promise<boolean>;
}

export const HISTORY_KEY = "chat:history:main";
// Présence : ZSET (score = expiration ms) + HASH des pseudos. Pas de clé par viewer, pas de SCAN.
export const PRESENCE_ZSET = "chat:presence:main";
export const PRESENCE_HASH = "chat:presence:main:pseudo";
// Présence SFU du streameur : ZSET, score = expiration ms. Une seule clé (SFU_STREAMER_LINK_ID).
export const STREAMER_LINK_ZSET = "chat:streamer:main";

interface MemoryEntry<T> {
  value: T;
  expiresAt: number;
}

// Implémentation mémoire (tests et déploiement sans Redis). Même contrat que la version Redis.
export function createMemoryChatState(options: { historySize: number }): ChatState {
  let history: ChatMessage[] = [];
  const presence = new Map<string, MemoryEntry<string | null>>();
  const streamerLinks = new Map<string, MemoryEntry<true>>();

  const live = <T>(map: Map<string, MemoryEntry<T>>, key: string): MemoryEntry<T> | undefined => {
    const entry = map.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return undefined;
    }
    return entry;
  };

  const expiry = (ttlSeconds: number): number => Date.now() + ttlSeconds * 1000;

  return {
    appendHistory(message) {
      history = [...history, message].slice(-options.historySize);
      return Promise.resolve();
    },
    recentHistory() {
      return Promise.resolve([...history]);
    },
    touchPresence(viewerId, pseudo, ttlSeconds) {
      presence.set(viewerId, { value: pseudo, expiresAt: expiry(ttlSeconds) });
      return Promise.resolve();
    },
    removePresence(viewerId) {
      presence.delete(viewerId);
      return Promise.resolve();
    },
    listPresence() {
      const entries: PresenceEntry[] = [];
      for (const viewerId of [...presence.keys()]) {
        const entry = live(presence, viewerId);
        if (entry !== undefined) {
          entries.push({ viewerId, pseudo: entry.value });
        }
      }
      return Promise.resolve(entries);
    },
    touchStreamerLink(linkId, ttlSeconds) {
      streamerLinks.set(linkId, { value: true, expiresAt: expiry(ttlSeconds) });
      return Promise.resolve();
    },
    removeStreamerLink(linkId) {
      streamerLinks.delete(linkId);
      return Promise.resolve();
    },
    hasStreamerLink(linkId) {
      return Promise.resolve(live(streamerLinks, linkId) !== undefined);
    },
  };
}

// Implémentation Redis : liste capée (LPUSH + LTRIM) pour l'historique ; ZSET (score = expiration)
// + HASH pour la présence et les liens streameur. Aucun SCAN : la lecture est O(log N + M),
// là où un SCAN parcourait tout l'espace de clés à chaque diffusion de présence.
export function createRedisChatState(options: { redis: Redis; historySize: number }): ChatState {
  const { redis, historySize } = options;

  return {
    async appendHistory(message) {
      await redis
        .multi()
        .lpush(HISTORY_KEY, JSON.stringify(message))
        .ltrim(HISTORY_KEY, 0, historySize - 1)
        .exec();
    },
    async recentHistory() {
      const raw = await redis.lrange(HISTORY_KEY, 0, -1);
      const messages: ChatMessage[] = [];
      for (const item of raw.reverse()) {
        const parsed = parseMessage(item);
        if (parsed !== null) {
          messages.push(parsed);
        }
      }
      return messages;
    },
    async touchPresence(viewerId, pseudo, ttlSeconds) {
      await redis
        .multi()
        .zadd(PRESENCE_ZSET, Date.now() + ttlSeconds * 1000, viewerId)
        .hset(PRESENCE_HASH, viewerId, pseudo ?? "")
        .exec();
    },
    async removePresence(viewerId) {
      await redis.multi().zrem(PRESENCE_ZSET, viewerId).hdel(PRESENCE_HASH, viewerId).exec();
    },
    async listPresence() {
      const now = Date.now();
      // Élagage des entrées expirées, puis lecture des membres vivants en une seule passe.
      const expired = await redis.zrangebyscore(PRESENCE_ZSET, "-inf", now);
      if (expired.length > 0) {
        await redis
          .multi()
          .zremrangebyscore(PRESENCE_ZSET, "-inf", now)
          .hdel(PRESENCE_HASH, ...expired)
          .exec();
      }
      const viewerIds = await redis.zrangebyscore(PRESENCE_ZSET, `(${String(now)}`, "+inf");
      if (viewerIds.length === 0) {
        return [];
      }
      const pseudos = await redis.hmget(PRESENCE_HASH, ...viewerIds);
      return viewerIds.map((viewerId, index) => {
        const pseudo = pseudos[index];
        return {
          viewerId,
          pseudo: pseudo === null || pseudo === undefined || pseudo === "" ? null : pseudo,
        };
      });
    },
    async touchStreamerLink(linkId, ttlSeconds) {
      await redis.zadd(STREAMER_LINK_ZSET, Date.now() + ttlSeconds * 1000, linkId);
    },
    async removeStreamerLink(linkId) {
      await redis.zrem(STREAMER_LINK_ZSET, linkId);
    },
    async hasStreamerLink(linkId) {
      const now = Date.now();
      await redis.zremrangebyscore(STREAMER_LINK_ZSET, "-inf", now);
      return (await redis.zscore(STREAMER_LINK_ZSET, linkId)) !== null;
    },
  };
}

function parseMessage(raw: string): ChatMessage | null {
  try {
    const result = ChatMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
