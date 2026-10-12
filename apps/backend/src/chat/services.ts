import type { Redis } from "ioredis";
import { createMemoryChatBus, createRedisChatBus, type BusLogger, type ChatBus } from "./bus.js";
import {
  createMemorySlidingWindowLimiter,
  createRedisSlidingWindowLimiter,
  type SlidingWindowLimiter,
} from "./rate-limit.js";
import { createMemoryChatState, createRedisChatState, type ChatState } from "./state.js";

// Ensemble des ports chat. Partagé entre instances : même bus, même état, même limiteur.
export interface ChatServices {
  bus: ChatBus;
  state: ChatState;
  limiter: SlidingWindowLimiter;
}

export function createMemoryChatServices(options: { historySize: number }): ChatServices {
  return {
    bus: createMemoryChatBus(),
    state: createMemoryChatState({ historySize: options.historySize }),
    limiter: createMemorySlidingWindowLimiter(),
  };
}

export interface RedisChatServicesDeps {
  // Connexion principale (état, rate-limit, publication).
  redis: Redis;
  // Connexion dédiée aux abonnements Pub/Sub.
  subscriber: Redis;
  historySize: number;
  log: BusLogger;
}

export async function createRedisChatServices(deps: RedisChatServicesDeps): Promise<ChatServices> {
  return {
    bus: await createRedisChatBus({
      publisher: deps.redis,
      subscriber: deps.subscriber,
      log: deps.log,
    }),
    state: createRedisChatState({ redis: deps.redis, historySize: deps.historySize }),
    limiter: createRedisSlidingWindowLimiter(deps.redis),
  };
}
