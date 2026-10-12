import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { banKey } from "../auth/viewer-identity.js";
import { cookieFrom, createHarness, jsonBody, type Harness } from "../test/harness.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let harness: Harness;
let app: FastifyInstance;

beforeEach(async () => {
  harness = await createHarness();
  app = harness.app;
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe("GET /api/me (viewer anonyme)", () => {
  it("émet un viewerId opaque UUID v4 sans mot de passe ni pseudo", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.role).toBe("viewer");
    expect(body.viewerId).toMatch(UUID_V4);
    expect(body.pseudo).toBeNull();
    const header = String(res.headers["set-cookie"]);
    expect(header).toContain(`${harness.names.viewer}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Max-Age");
  });

  it("conserve le même viewerId à chaque appel avec le cookie", async () => {
    const first = await app.inject({ method: "GET", url: "/api/me" });
    const cookie = cookieFrom(first.headers["set-cookie"], harness.names.viewer);
    const second = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${harness.names.viewer}=${cookie}` },
    });
    expect(jsonBody(second).viewerId).toBe(jsonBody(first).viewerId);
    expect(second.headers["set-cookie"]).toBeUndefined();
  });

  it("remplace un cookie viewer falsifié par une nouvelle identité (pas de 500)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${harness.names.viewer}=aaa.bbb.ccc` },
    });
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).viewerId).toMatch(UUID_V4);
  });
});

describe("PUT /api/me/pseudo", () => {
  it("enregistre le pseudo sans changer le viewerId", async () => {
    const first = await app.inject({ method: "GET", url: "/api/me" });
    const viewerId = jsonBody(first).viewerId as string;
    const cookie = cookieFrom(first.headers["set-cookie"], harness.names.viewer);
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      payload: { pseudo: "Alice_01" },
      headers: { cookie: `${harness.names.viewer}=${cookie}` },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      role: "viewer",
      viewerId,
      pseudo: "Alice_01",
      color: null,
    });
  });

  it("rejette un pseudo invalide ou un champ inconnu (400)", async () => {
    const tooShort = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      payload: { pseudo: "ab" },
    });
    expect(tooShort.statusCode).toBe(400);
    const html = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      payload: { pseudo: "<script>" },
    });
    expect(html.statusCode).toBe(400);
    const extra = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      payload: { pseudo: "Alice", viewerId: "forged" },
    });
    expect(extra.statusCode).toBe(400);
  });

  it("ne donne aucun droit : un pseudo 'SoloMaster' reste un viewer", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      payload: { pseudo: "SoloMaster" },
    });
    expect(jsonBody(res).role).toBe("viewer");
  });
});

describe("bans viewer", () => {
  it("refuse /api/me à un viewerId banni (403)", async () => {
    const first = await app.inject({ method: "GET", url: "/api/me" });
    const viewerId = jsonBody(first).viewerId as string;
    const cookie = cookieFrom(first.headers["set-cookie"], harness.names.viewer);
    await harness.store.set(banKey(viewerId), "1", 3600);
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${harness.names.viewer}=${cookie}` },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: "viewer_banned" });
  });

  it("requireViewer refuse un banni et exige une identité", async () => {
    const local = await createHarness();
    local.app.get(
      "/test/viewer-only",
      { preHandler: [local.app.authMiddleware.requireViewer] },
      () => ({ ok: true }),
    );
    await local.app.ready();
    const anonymous = await local.app.inject({ method: "GET", url: "/test/viewer-only" });
    expect(anonymous.statusCode).toBe(401);

    const first = await local.app.inject({ method: "GET", url: "/api/me" });
    const viewerId = jsonBody(first).viewerId as string;
    const cookie = cookieFrom(first.headers["set-cookie"], local.names.viewer);
    await local.store.set(banKey(viewerId), "1", 3600);
    const banned = await local.app.inject({
      method: "GET",
      url: "/test/viewer-only",
      headers: { cookie: `${local.names.viewer}=${cookie}` },
    });
    expect(banned.statusCode).toBe(403);
    await local.app.close();
  });
});

describe("GET /api/me avec cookie streameur", () => {
  it("renvoie role=streamer", async () => {
    const opened = await app.inject({
      method: "POST",
      url: "/api/studio/open",
    });
    const streamerCookie = cookieFrom(opened.headers["set-cookie"], harness.names.streamer);
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${harness.names.streamer}=${streamerCookie}` },
    });
    expect(jsonBody(res).role).toBe("streamer");
  });
});
