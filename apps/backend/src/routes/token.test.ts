import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { banKey } from "../auth/viewer-identity.js";
import { stageSetKey } from "../stage/stage-registry.js";
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

// Crée un viewer et renvoie son cookie + viewerId.
async function newViewer(): Promise<{ cookie: string; viewerId: string }> {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  const cookie = cookieFrom(res.headers["set-cookie"], harness.names.viewer);
  return { cookie, viewerId: String(jsonBody(res).viewerId) };
}

const requestToken = (cookieName: string, cookie: string) =>
  app.inject({
    method: "POST",
    url: "/api/token",
    headers: { cookie: `${cookieName}=${cookie}` },
  });

// Accorde la parole via la route réelle (streameur authentifié).
async function grantSpeech(viewerId: string): Promise<void> {
  const opened = await app.inject({
    method: "POST",
    url: "/api/studio/open",
  });
  const streamer = cookieFrom(opened.headers["set-cookie"], harness.names.streamer);
  const res = await app.inject({
    method: "POST",
    url: "/api/stage/grant",
    headers: { cookie: `${harness.names.streamer}=${streamer}` },
    payload: { viewerId },
  });
  if (res.statusCode !== 204) {
    throw new Error(`grant de test refusé : ${String(res.statusCode)}`);
  }
}

describe("POST /api/token (viewer)", () => {
  it("viewer passif (sans grant) : token d'abonnement seul, aucune publication", async () => {
    const viewer = await newViewer();
    const res = await requestToken(harness.names.viewer, viewer.cookie);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.canPublishAudio).toBe(false);
    expect(body.canPublishVideo).toBe(false);
    expect(body.identity).toBe(viewer.viewerId);
    expect(harness.livekit.grants.at(-1)).toMatchObject({
      identity: viewer.viewerId,
      canPublishAudio: false,
      canPublishVideo: false,
    });
  });

  it("viewer avec grant can_speak : canPublishAudio=true, canPublishVideo=false", async () => {
    const viewer = await newViewer();
    await grantSpeech(viewer.viewerId);
    const res = await requestToken(harness.names.viewer, viewer.cookie);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.canPublishAudio).toBe(true);
    expect(body.canPublishVideo).toBe(false);
    expect(body.identity).toBe(viewer.viewerId);
    expect(body.identity).toMatch(UUID_V4);
    expect(body.livekitUrl).toBe("ws://127.0.0.1:7880");
    expect(String(res.headers["cache-control"])).toBe("no-store");
    expect(harness.livekit.grants.at(-1)).toMatchObject({
      identity: viewer.viewerId,
      canPublishAudio: true,
      canPublishVideo: false,
    });
  });

  it("un viewer ne peut JAMAIS obtenir canPublishVideo=true", async () => {
    const viewer = await newViewer();
    const before = await requestToken(harness.names.viewer, viewer.cookie);
    await grantSpeech(viewer.viewerId);
    const after = await requestToken(harness.names.viewer, viewer.cookie);
    expect(jsonBody(before).canPublishVideo).toBe(false);
    expect(jsonBody(after).canPublishVideo).toBe(false);
    expect(harness.livekit.grants.every((grant) => !grant.canPublishVideo)).toBe(true);
  });

  it("aucun champ client ne peut élever un droit (corps strict : 400)", async () => {
    const viewer = await newViewer();
    const res = await app.inject({
      method: "POST",
      url: "/api/token",
      headers: { cookie: `${harness.names.viewer}=${viewer.cookie}` },
      payload: { canPublishVideo: true, canPublishAudio: true },
    });
    expect(res.statusCode).toBe(400);
    expect(harness.livekit.grants).toHaveLength(0);
  });

  it("n'utilise jamais le pseudo comme identité LiveKit", async () => {
    const viewer = await newViewer();
    await grantSpeech(viewer.viewerId);
    const renamed = await app.inject({
      method: "PUT",
      url: "/api/me/pseudo",
      headers: { cookie: `${harness.names.viewer}=${viewer.cookie}` },
      payload: { pseudo: "Alice_42" },
    });
    const renamedCookie = cookieFrom(renamed.headers["set-cookie"], harness.names.viewer);
    const body = jsonBody(await requestToken(harness.names.viewer, renamedCookie));
    expect(body.identity).toBe(viewer.viewerId);
    expect(body.identity).not.toBe("Alice_42");
  });

  it("viewer banni : 403, aucun token émis", async () => {
    const viewer = await newViewer();
    await harness.store.set(banKey(viewer.viewerId), "1", 3600);
    const res = await requestToken(harness.names.viewer, viewer.cookie);
    expect(res.statusCode).toBe(403);
    expect(jsonBody(res).error).toBe("viewer_banned");
    expect(harness.livekit.grants).toHaveLength(0);
  });

  it("sans cookie : 401", async () => {
    const res = await app.inject({ method: "POST", url: "/api/token" });
    expect(res.statusCode).toBe(401);
  });

  it("le grant est lié à la session viewer : une clé de parole d'un autre viewer n'élève rien", async () => {
    const alice = await newViewer();
    const bob = await newViewer();
    await grantSpeech(alice.viewerId);
    const res = await requestToken(harness.names.viewer, bob.cookie);
    expect(res.statusCode).toBe(200);
    expect(jsonBody(res).canPublishAudio).toBe(false);
    expect(await harness.store.hasSlot(stageSetKey("main"), alice.viewerId)).toBe(true);
  });
});

describe("POST /api/token (streameur)", () => {
  it("streameur : identity fixe 'streamer', audio + vidéo publiables", async () => {
    const opened = await app.inject({
      method: "POST",
      url: "/api/studio/open",
    });
    const streamer = cookieFrom(opened.headers["set-cookie"], harness.names.streamer);
    const res = await requestToken(harness.names.streamer, streamer);
    expect(res.statusCode).toBe(200);
    const body = jsonBody(res);
    expect(body.identity).toBe("streamer");
    expect(body.canPublishAudio).toBe(true);
    expect(body.canPublishVideo).toBe(true);
  });

  it("un cookie viewer présenté comme cookie streameur n'obtient jamais le rôle streameur", async () => {
    const viewer = await newViewer();
    const res = await requestToken(harness.names.streamer, viewer.cookie);
    expect(res.statusCode).toBe(401);
    expect(harness.livekit.grants).toHaveLength(0);
  });
});

describe("POST /api/token : la room fixe est créée avant l'émission", () => {
  it("appelle ensureRoom (room.auto_create = false côté SFU)", async () => {
    await app.inject({ method: "GET", url: "/api/me" });
    const me = await app.inject({ method: "GET", url: "/api/me" });
    const viewer = cookieFrom(me.headers["set-cookie"], harness.names.viewer);
    const before = harness.livekit.roomEnsured;
    const res = await requestToken(harness.names.viewer, viewer);
    expect(res.statusCode).toBe(200);
    expect(harness.livekit.roomEnsured).toBe(before + 1);
  });

  it("renvoie 502 sfu_unavailable si la room ne peut pas être créée", async () => {
    const me = await app.inject({ method: "GET", url: "/api/me" });
    const viewer = cookieFrom(me.headers["set-cookie"], harness.names.viewer);
    harness.livekit.failEnsureRoom = new Error("ECONNREFUSED");
    const res = await requestToken(harness.names.viewer, viewer);
    harness.livekit.failEnsureRoom = undefined;
    expect(res.statusCode).toBe(502);
    expect(jsonBody(res)).toMatchObject({ error: "sfu_unavailable" });
  });
});
