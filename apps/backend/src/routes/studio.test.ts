import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { STUDIO_SLOT_KEY } from "../auth/streamer-auth.js";
import { cookieFrom, createHarness, type Harness } from "../test/harness.js";

let harness: Harness;
let app: FastifyInstance;

async function setup(overrides: Record<string, string> = {}): Promise<void> {
  harness = await createHarness(overrides);
  app = harness.app;
  // Route de test protégée : valide le comportement de requireStreamer sur une route réelle.
  app.get("/test/streamer-only", { preHandler: [app.authMiddleware.requireStreamer] }, () => ({
    ok: true,
  }));
  await app.ready();
}

const open = (cookie?: string) =>
  app.inject({
    method: "POST",
    url: "/api/studio/open",
    ...(cookie === undefined ? {} : { headers: { cookie: `${harness.names.streamer}=${cookie}` } }),
  });

describe("POST /api/studio/open et requireStreamer", () => {
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await app.close();
  });

  it("pose le cookie studio à l'ouverture (httpOnly, SameSite=Lax, 12 h)", async () => {
    const res = await open();
    expect(res.statusCode).toBe(204);
    const header = String(res.headers["set-cookie"]);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=43200");
    expect(header).not.toContain("Secure");
  });

  it("une ouverture sans corps suffit (aucune clé d'entrée)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/studio/open" });
    expect(res.statusCode).toBe(204);
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(1);
  });

  it("renvoie 403 à requireStreamer sans cookie valide", async () => {
    const res = await app.inject({ method: "GET", url: "/test/streamer-only" });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: "forbidden" });
  });

  it("laisse passer requireStreamer avec le cookie studio", async () => {
    const res = await open();
    const token = cookieFrom(res.headers["set-cookie"], harness.names.streamer);
    const guarded = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${harness.names.streamer}=${token}` },
    });
    expect(guarded.statusCode).toBe(200);
  });

  it("refuse un cookie viewer présenté comme cookie studio (audience distincte)", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me" });
    const viewerToken = cookieFrom(me.headers["set-cookie"], harness.names.viewer);
    const res = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${harness.names.streamer}=${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuse un corps avec un champ inconnu (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/studio/open",
      payload: { role: "streamer" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("applique le rate-limit sur open après N appels", async () => {
    await app.close();
    await setup({ STUDIO_RATE_LIMIT_MAX: "3" });
    // Le même navigateur rouvre : il rend son bail puis le reprend, donc 204 à chaque fois.
    let cookie: string | undefined;
    for (let i = 0; i < 3; i += 1) {
      const res = await open(cookie);
      expect(res.statusCode).toBe(204);
      cookie = cookieFrom(res.headers["set-cookie"], harness.names.streamer);
    }
    expect((await open(cookie)).statusCode).toBe(429);
  });

  it("un second navigateur prend la place : le cookie du premier ne commande plus rien", async () => {
    const first = await open();
    const firstToken = cookieFrom(first.headers["set-cookie"], harness.names.streamer);

    const second = await open();
    expect(second.statusCode).toBe(204);
    const secondToken = cookieFrom(second.headers["set-cookie"], harness.names.streamer);
    expect(secondToken).not.toBe(firstToken);

    // Un seul bail, tenu par le dernier arrivé.
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(1);
    const evicted = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${harness.names.streamer}=${firstToken}` },
    });
    expect(evicted.statusCode).toBe(403);
    const holder = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${harness.names.streamer}=${secondToken}` },
    });
    expect(holder.statusCode).toBe(200);
  });

  it("après close, le studio est libre et la place rendue", async () => {
    const held = await open();
    const token = cookieFrom(held.headers["set-cookie"], harness.names.streamer);

    const closed = await app.inject({
      method: "POST",
      url: "/api/studio/close",
      headers: { cookie: `${harness.names.streamer}=${token}` },
    });
    expect(closed.statusCode).toBe(204);
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(0);
    expect((await open()).statusCode).toBe(204);
  });

  it("le bail du studio est pris à l'ouverture et rendu à la fermeture", async () => {
    const held = await open();
    const token = cookieFrom(held.headers["set-cookie"], harness.names.streamer);
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(1);

    await app.inject({
      method: "POST",
      url: "/api/studio/close",
      headers: { cookie: `${harness.names.streamer}=${token}` },
    });
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(0);
  });

  it("close révoque le jeton : requireStreamer renvoie ensuite 403", async () => {
    const res = await open();
    const name = harness.names.streamer;
    const token = cookieFrom(res.headers["set-cookie"], name);
    const closed = await app.inject({
      method: "POST",
      url: "/api/studio/close",
      headers: { cookie: `${name}=${token}` },
    });
    expect(closed.statusCode).toBe(204);
    expect(String(closed.headers["set-cookie"])).toContain(`${name}=;`);
    const after = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${name}=${token}` },
    });
    expect(after.statusCode).toBe(403);
  });

  it("rotation : un nouvel open invalide le jeton précédent", async () => {
    const name = harness.names.streamer;
    const first = cookieFrom((await open()).headers["set-cookie"], name);
    const second = await open(first);
    expect(second.statusCode).toBe(204);
    const old = await app.inject({
      method: "GET",
      url: "/test/streamer-only",
      headers: { cookie: `${name}=${first}` },
    });
    expect(old.statusCode).toBe(403);
  });

  it("ne journalise jamais le jeton de session studio", async () => {
    const res = await open();
    const token = cookieFrom(res.headers["set-cookie"], harness.names.streamer);
    expect(harness.logs()).toContain("studio.open");
    expect(harness.logs()).not.toContain(token);
  });
});

describe("POST /api/studio/ingest", () => {
  beforeEach(async () => {
    await setup();
  });
  afterEach(async () => {
    await app.close();
  });

  const ingest = (cookie?: string) =>
    app.inject({
      method: "POST",
      url: "/api/studio/ingest",
      ...(cookie === undefined
        ? {}
        : { headers: { cookie: `${harness.names.streamer}=${cookie}` } }),
    });

  it("renvoie l'URL RTMP et la clé de flux au streameur, sans cache", async () => {
    const token = cookieFrom((await open()).headers["set-cookie"], harness.names.streamer);
    const res = await ingest(token);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      url: "rtmp://localhost:1935/x",
      streamKey: "fake-stream-key",
    });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuse un viewer (403) : la clé de flux vaut droit de publier", async () => {
    expect((await ingest()).statusCode).toBe(403);
  });

  it("renvoie 502 quand le service Ingress ne répond pas", async () => {
    const token = cookieFrom((await open()).headers["set-cookie"], harness.names.streamer);
    harness.livekit.ingress = null;
    const res = await ingest(token);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body)).toMatchObject({ error: "ingress_unavailable" });
  });

  it("ne journalise jamais la clé de flux", async () => {
    const token = cookieFrom((await open()).headers["set-cookie"], harness.names.streamer);
    await ingest(token);
    expect(harness.logs()).toContain("studio.ingest");
    expect(harness.logs()).not.toContain("fake-stream-key");
  });
});
