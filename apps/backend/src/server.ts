import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { createMemoryChatServices, createRedisChatServices } from "./chat/services.js";
import { loadConfig, ConfigError, type AppConfig } from "./config.js";
import {
  createRedisKeyValueStore,
  MemoryKeyValueStore,
  type KeyValueStore,
} from "./state/key-value-store.js";
import type { ChatServices } from "./chat/services.js";

interface Runtime {
  store: KeyValueStore;
  chat: ChatServices;
  redis?: Redis;
  dispose: () => void;
}

/**
 * STATE_BACKEND=memory: everything lives in this process (local run, no Redis to install).
 * STATE_BACKEND=redis: shared state, mandatory for more than one backend instance.
 */
async function createRuntime(
  config: AppConfig,
  log: () => FastifyInstance | undefined,
): Promise<Runtime> {
  if (config.STATE_BACKEND === "memory") {
    return {
      store: new MemoryKeyValueStore(),
      chat: createMemoryChatServices({ historySize: config.CHAT_HISTORY_SIZE }),
      dispose: () => undefined,
    };
  }
  if (config.REDIS_URL === undefined) {
    // Unreachable: loadConfig already rejects STATE_BACKEND=redis without REDIS_URL.
    throw new Error("REDIS_URL is required when STATE_BACKEND=redis");
  }
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const subscriber = redis.duplicate();
  // Only the error type is logged: the Redis URL carries the password.
  subscriber.on("error", (error: Error) => {
    const instance = log();
    instance?.log.error({ errorName: error.name }, "Redis subscriber error");
  });
  // The app does not exist yet when the bus is created: the logger is resolved at call time and
  // falls back to stderr if a message arrives before Fastify is built.
  const logBus = {
    warn: (context: Record<string, unknown>, message: string) => {
      const instance = log();
      if (instance === undefined) {
        process.stderr.write(`${message} ${JSON.stringify(context)}\n`);
        return;
      }
      instance.log.warn(context, message);
    },
  };
  const chat = await createRedisChatServices({
    redis,
    subscriber,
    historySize: config.CHAT_HISTORY_SIZE,
    log: logBus,
  });
  return {
    store: createRedisKeyValueStore(redis),
    chat,
    redis,
    dispose: () => {
      subscriber.disconnect();
      redis.disconnect();
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  let instance: FastifyInstance | undefined;
  const runtime = await createRuntime(config, () => instance);

  const app = await buildApp({
    config,
    store: runtime.store,
    chat: runtime.chat,
    ...(runtime.redis === undefined ? {} : { redis: runtime.redis }),
  });
  instance = app;

  // Redis error: only the error type is logged (the URL carries the Redis password).
  if (runtime.redis !== undefined) {
    const onRedisError = (error: Error): void => {
      app.log.error({ errorName: error.name }, "Redis connection error");
    };
    runtime.redis.on("error", onRedisError);
  }

  const shutdown = async (): Promise<void> => {
    await app.close();
    runtime.dispose();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());

  await app.listen({ host: config.BACKEND_HOST, port: config.BACKEND_PORT });
  app.log.info(
    { event: "server.started", state: config.STATE_BACKEND, port: config.BACKEND_PORT },
    "SoloCast backend listening",
  );
}

// Codes système courants au démarrage, traduits en une phrase actionnable. La valeur n'est
// jamais reprise telle quelle : un code errno ne porte ni secret ni entrée utilisateur.
const STARTUP_HINTS: Readonly<Record<string, string>> = {
  EADDRINUSE: "BACKEND_PORT is already in use (another backend or `pnpm dev` is running)",
  EACCES: "BACKEND_PORT is not permitted for this user",
  EADDRNOTAVAIL: "BACKEND_HOST is not an address of this machine",
};

main().catch((error: unknown) => {
  // ConfigError messages never contain an input value.
  if (error instanceof ConfigError) {
    process.stderr.write(`Startup failed: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  // Only the error type and its system code are printed: enough to act on, nothing sensitive.
  const rawCode: unknown = (error as { code?: unknown }).code;
  const code = typeof rawCode === "string" ? rawCode : undefined;
  const name = error instanceof Error ? error.name : "UnknownError";
  const hint = code === undefined ? undefined : STARTUP_HINTS[code];
  const detail = [name, code, hint].filter((part) => part !== undefined).join(": ");
  process.stderr.write(`Startup failed: ${detail}\n`);
  process.exitCode = 1;
});
