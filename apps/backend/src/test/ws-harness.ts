import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { once } from "node:events";
import { WebSocket } from "ws";
import type { ServerWsMessage } from "@solocast/shared";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ChatServices } from "../chat/services.js";
import { createMemoryChatServices } from "../chat/services.js";
import { cookieFrom, jsonBody } from "./harness.js";
import {
  FakeLiveKitGateway,
  MemoryKeyValueStore,
  createTestEnv,
} from "./fakes.js";
import type { FastifyInstance } from "fastify";

// État partagé entre « instances » : même store, même bus, même SFU factice (équivalent Redis + LiveKit).
export interface SharedBackend {
  env: NodeJS.ProcessEnv;
  store: MemoryKeyValueStore;
  chat: ChatServices;
  livekit: FakeLiveKitGateway;
  // Sortie de logs partagée (vérification de l'absence de texte et de secrets).
  sink: string[];
  names: { streamer: string; viewer: string };
  origin: string;
}

export function createSharedBackend(overrides: Record<string, string> = {}): SharedBackend {
  const env = createTestEnv(overrides);
  return {
    env,
    store: new MemoryKeyValueStore(),
    chat: createMemoryChatServices({ historySize: Number(env.CHAT_HISTORY_SIZE ?? 200) }),
    livekit: new FakeLiveKitGateway(),
    sink: [],
    names: { streamer: env.SESSION_COOKIE_NAME ?? "", viewer: env.VIEWER_COOKIE_NAME ?? "" },
    origin: env.CORS_ORIGIN ?? "",
  };
}

export interface RunningInstance {
  app: FastifyInstance;
  port: number;
}

export async function startInstance(backend: SharedBackend): Promise<RunningInstance> {
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      backend.sink.push(chunk.toString("utf8"));
      callback();
    },
  });
  const app = await buildApp({
    config: loadConfig(backend.env),
    store: backend.store,
    logStream,
    livekit: backend.livekit,
    chat: backend.chat,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  return { app, port };
}

export async function viewerCookie(
  app: FastifyInstance,
  names: { viewer: string },
): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  return cookieFrom(res.headers["set-cookie"], names.viewer);
}

// Fixe le pseudo via PUT /api/me/pseudo (WP1) et renvoie le cookie viewer mis à jour.
export async function setPseudo(
  app: FastifyInstance,
  names: { viewer: string },
  cookie: string,
  pseudo: string,
): Promise<string> {
  const res = await app.inject({
    method: "PUT",
    url: "/api/me/pseudo",
    payload: { pseudo },
    headers: { cookie: `${names.viewer}=${cookie}` },
  });
  return cookieFrom(res.headers["set-cookie"], names.viewer);
}

export async function viewerIdOf(
  app: FastifyInstance,
  cookie: string,
  names: { viewer: string },
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: `${names.viewer}=${cookie}` },
  });
  return String(jsonBody(res).viewerId);
}

export async function streamerCookieOf(
  app: FastifyInstance,
  backend: SharedBackend,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/studio/open",
  });
  return cookieFrom(res.headers["set-cookie"], backend.names.streamer);
}

// Client WebSocket de test : collecte les messages serveur et la fermeture.
export class ChatClient {
  readonly messages: ServerWsMessage[] = [];
  closed: { code: number; reason: string } | undefined;
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data: Buffer) => {
      this.messages.push(JSON.parse(data.toString("utf8")) as ServerWsMessage);
    });
    socket.on("close", (code: number, reason: Buffer) => {
      this.closed = { code, reason: reason.toString("utf8") };
    });
  }

  static async connect(port: number, headers: Record<string, string>): Promise<ChatClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { headers });
    const client = new ChatClient(socket);
    await once(socket, "open");
    return client;
  }

  // Tentative d'upgrade refusée : renvoie le statut HTTP reçu avant upgrade.
  static async refused(port: number, headers: Record<string, string>): Promise<number> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, { headers });
    socket.on("error", () => undefined);
    // ws émet (requête, réponse HTTP) : seule la réponse porte le statut.
    const [, response] = (await once(socket, "unexpected-response")) as [
      unknown,
      { statusCode?: number },
    ];
    return response.statusCode ?? 0;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  async waitFor(
    predicate: (message: ServerWsMessage) => boolean,
    timeoutMs = 2_000,
  ): Promise<ServerWsMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found !== undefined) {
        return found;
      }
      if (Date.now() > deadline) {
        throw new Error("waitFor : message attendu absent (délai dépassé)");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async waitClosed(timeoutMs = 2_000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (this.closed === undefined) {
      if (Date.now() > deadline) {
        throw new Error("waitClosed : socket toujours ouverte");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.closed;
  }

  close(): void {
    this.socket.terminate();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
