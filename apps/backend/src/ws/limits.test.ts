import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { VIEWER_SLOT_KEY } from "../room/viewer-capacity.js";
import {
  ChatClient,
  createSharedBackend,
  setPseudo,
  sleep,
  startInstance,
  viewerCookie,
  type RunningInstance,
  type SharedBackend,
} from "../test/ws-harness.js";

// Derrière un reverse-proxy (TRUST_PROXY) : l'IP client vient de X-Forwarded-For, ce qui permet de
// simuler plusieurs adresses depuis 127.0.0.1. Le mode proxy impose une clé studio.
const proxiedEnv = (extra: Record<string, string> = {}) => ({
  TRUST_PROXY: "true",
  STUDIO_ACCESS: "key",
  STUDIO_KEY: randomBytes(32).toString("hex"),
  ...extra,
});

let backend: SharedBackend;
let instance: RunningInstance | undefined;
const clients: ChatClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await instance?.app.close();
  instance = undefined;
});

async function newViewerCookie(pseudo: string): Promise<string> {
  const app = (instance as RunningInstance).app;
  const first = await viewerCookie(app, { viewer: backend.names.viewer });
  return setPseudo(app, { viewer: backend.names.viewer }, first, pseudo);
}

const headersFor = (cookie: string, ip: string) => ({
  cookie: `${backend.names.viewer}=${cookie}`,
  origin: backend.origin,
  "x-forwarded-for": ip,
});

describe("plafond de connexions WebSocket par IP", () => {
  it("refuse au-delà de WS_MAX_CONNECTIONS_PER_IP depuis une même IP, pas depuis une autre", async () => {
    backend = createSharedBackend(proxiedEnv({ WS_MAX_CONNECTIONS_PER_IP: "2" }));
    instance = await startInstance(backend);
    const port = instance.port;
    for (const pseudo of ["alice", "bobby"]) {
      const client = await ChatClient.connect(
        port,
        headersFor(await newViewerCookie(pseudo), "203.0.113.7"),
      );
      clients.push(client);
      await client.waitFor((m) => m.type === "chat:history");
    }
    const third = await newViewerCookie("carol");
    expect(await ChatClient.refused(port, headersFor(third, "203.0.113.7"))).toBe(429);

    const elsewhere = await ChatClient.connect(port, headersFor(third, "198.51.100.4"));
    clients.push(elsewhere);
    await elsewhere.waitFor((m) => m.type === "chat:history");
  });

  it("libère la place IP à la fermeture de la socket", async () => {
    backend = createSharedBackend(proxiedEnv({ WS_MAX_CONNECTIONS_PER_IP: "1" }));
    instance = await startInstance(backend);
    const cookie = await newViewerCookie("alice");
    const first = await ChatClient.connect(instance.port, headersFor(cookie, "203.0.113.8"));
    await first.waitFor((m) => m.type === "chat:history");
    expect(await ChatClient.refused(instance.port, headersFor(cookie, "203.0.113.8"))).toBe(429);
    first.close();
    await sleep(100);
    const again = await ChatClient.connect(instance.port, headersFor(cookie, "203.0.113.8"));
    clients.push(again);
    await again.waitFor((m) => m.type === "chat:history");
  });

  it("ne plafonne pas cette machine (loopback : studio et onglets locaux)", async () => {
    backend = createSharedBackend({ WS_MAX_CONNECTIONS_PER_IP: "1" });
    instance = await startInstance(backend);
    for (const pseudo of ["alice", "bobby"]) {
      const client = await ChatClient.connect(instance.port, {
        cookie: `${backend.names.viewer}=${await newViewerCookie(pseudo)}`,
        origin: backend.origin,
      });
      clients.push(client);
      await client.waitFor((m) => m.type === "chat:history");
    }
  });
});

describe("heartbeat ping/pong", () => {
  it("coupe une socket qui ne répond plus aux pings et libère sa place", async () => {
    backend = createSharedBackend({ WS_HEARTBEAT_INTERVAL_MS: "1000" });
    instance = await startInstance(backend);
    const port = instance.port;
    const deaf = await ChatClient.connect(
      port,
      {
        cookie: `${backend.names.viewer}=${await newViewerCookie("alice")}`,
        origin: backend.origin,
      },
      { autoPong: false },
    );
    clients.push(deaf);
    await deaf.waitFor((m) => m.type === "chat:history");
    expect(await backend.store.countSlots(VIEWER_SLOT_KEY)).toBe(1);

    const healthy = await ChatClient.connect(port, {
      cookie: `${backend.names.viewer}=${await newViewerCookie("bobby")}`,
      origin: backend.origin,
    });
    clients.push(healthy);
    await healthy.waitFor((m) => m.type === "chat:history");

    // Premier tick : ping ; second tick : pas de pong -> terminate (code 1006 côté client).
    const closed = await deaf.waitClosed(4_000);
    expect(closed.code).toBe(1006);
    await sleep(100);
    expect(await backend.store.countSlots(VIEWER_SLOT_KEY)).toBe(1);
    expect(healthy.closed).toBeUndefined();
  });
});
