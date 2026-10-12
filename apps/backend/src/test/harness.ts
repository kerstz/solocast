import type { FastifyInstance } from "fastify";
import { Writable } from "node:stream";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  FakeLiveKitGateway,
  MemoryKeyValueStore,
  RecordingStageNotifier,
  createTestEnv,
} from "./fakes.js";

export interface Harness {
  app: FastifyInstance;
  store: MemoryKeyValueStore;
  env: NodeJS.ProcessEnv;
  names: { streamer: string; viewer: string };
  logs: () => string;
  livekit: FakeLiveKitGateway;
  notifier: RecordingStageNotifier;
}

// Construit l'app réelle (config Zod incluse) avec un store mémoire : aucune dépendance réseau.
export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const env = createTestEnv(overrides);
  const chunks: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString("utf8"));
      callback();
    },
  });
  const store = new MemoryKeyValueStore();
  const livekit = new FakeLiveKitGateway();
  const notifier = new RecordingStageNotifier();
  const app = await buildApp({
    config: loadConfig(env),
    store,
    logStream,
    livekit,
    stageNotifier: notifier,
  });
  const names = { streamer: env.SESSION_COOKIE_NAME ?? "", viewer: env.VIEWER_COOKIE_NAME ?? "" };
  return { app, store, env, names, logs: () => chunks.join(""), livekit, notifier };
}

type JsonRecord = Record<string, string | null>;

export function jsonBody(res: { body: string }): JsonRecord {
  return JSON.parse(res.body) as JsonRecord;
}

// Extrait la valeur d'un cookie depuis les en-têtes Set-Cookie ('' si absent).
export function cookieFrom(setCookie: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  for (const header of headers) {
    const [pair] = header.split(";");
    if (pair !== undefined && pair.startsWith(`${name}=`)) {
      return pair.slice(name.length + 1);
    }
  }
  return "";
}
