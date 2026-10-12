import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { banKey } from "../auth/viewer-identity.js";
import { stageSetKey } from "../stage/stage-registry.js";
import { cookieFrom, createHarness, jsonBody, type Harness } from "../test/harness.js";

let harness: Harness;
let app: FastifyInstance;

// Le studio n'a qu'un détenteur : le cookie est pris une fois par app, puis réutilisé.
let studioCookie: string | null = null;

async function setup(overrides: Record<string, string> = {}): Promise<void> {
  harness = await createHarness(overrides);
  app = harness.app;
  studioCookie = null;
  await app.ready();
}

afterEach(async () => {
  await app.close();
});

async function streamerCookie(): Promise<string> {
  if (studioCookie !== null) {
    return studioCookie;
  }
  const res = await app.inject({
    method: "POST",
    url: "/api/studio/open",
  });
  studioCookie = cookieFrom(res.headers["set-cookie"], harness.names.streamer);
  return studioCookie;
}

async function newViewer(): Promise<{ cookie: string; viewerId: string }> {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  return {
    cookie: cookieFrom(res.headers["set-cookie"], harness.names.viewer),
    viewerId: String(jsonBody(res).viewerId),
  };
}

// Viewer ayant choisi un pseudo : condition pour demander la parole (sinon 400).
async function newNamedViewer(pseudo: string): Promise<{ cookie: string; viewerId: string }> {
  const viewer = await newViewer();
  const res = await app.inject({
    method: "PUT",
    url: "/api/me/pseudo",
    headers: { cookie: `${harness.names.viewer}=${viewer.cookie}` },
    payload: { pseudo },
  });
  return {
    cookie: cookieFrom(res.headers["set-cookie"], harness.names.viewer),
    viewerId: viewer.viewerId,
  };
}

const stageCall = (
  url: string,
  cookie: { name: string; value: string } | undefined,
  payload?: unknown,
) =>
  app.inject({
    method: "POST",
    url,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    ...(cookie === undefined ? {} : { headers: { cookie: `${cookie.name}=${cookie.value}` } }),
  });

const grantAs = async (viewerId: string) =>
  stageCall(
    "/api/stage/grant",
    { name: harness.names.streamer, value: await streamerCookie() },
    { viewerId },
  );

describe("POST /api/stage/grant", () => {
  beforeEach(async () => {
    await setup();
  });

  it("refuse sans cookie streameur (403) et refuse un cookie viewer (403)", async () => {
    const viewer = await newViewer();
    const none = await stageCall("/api/stage/grant", undefined, { viewerId: viewer.viewerId });
    expect(none.statusCode).toBe(403);
    const asViewer = await stageCall(
      "/api/stage/grant",
      { name: harness.names.viewer, value: viewer.cookie },
      { viewerId: viewer.viewerId },
    );
    expect(asViewer.statusCode).toBe(403);
    expect(harness.notifier.events).toHaveLength(0);
  });

  it("accorde la parole : clé Redis posée, stage:granted émis au viewer", async () => {
    const viewer = await newViewer();
    const res = await grantAs(viewer.viewerId);
    expect(res.statusCode).toBe(204);
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(true);
    expect(harness.notifier.events).toEqual([
      { event: "stage:granted", viewerId: viewer.viewerId },
    ]);
  });

  it("valide la cible : viewerId non UUID ou champ en trop -> 400", async () => {
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    expect((await stageCall("/api/stage/grant", streamer, { viewerId: "alice" })).statusCode).toBe(
      400,
    );
    const viewer = await newViewer();
    const extra = await stageCall("/api/stage/grant", streamer, {
      viewerId: viewer.viewerId,
      canPublishVideo: true,
    });
    expect(extra.statusCode).toBe(400);
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(false);
  });

  it("élève aussi les droits côté SFU (audio seulement), sans échouer si le SFU est en panne", async () => {
    await setup();
    const viewer = await newViewer();
    const res = await grantAs(viewer.viewerId);
    expect(res.statusCode).toBe(204);
    expect(harness.livekit.updates).toHaveLength(1);
    expect(harness.livekit.updates[0]?.identity).toBe(viewer.viewerId);
    expect(harness.livekit.updates[0]?.permission.canPublishAudio).toBe(true);
    expect(harness.livekit.updates[0]?.permission.canPublishVideo).toBe(false);

    harness.livekit.failUpdates = new Error("sfu down");
    const second = await newViewer();
    expect((await grantAs(second.viewerId)).statusCode).toBe(204);
  });

  it("refuse un viewer banni (403) sans poser de grant", async () => {
    const viewer = await newViewer();
    await harness.store.set(banKey(viewer.viewerId), "1", 3600);
    const res = await grantAs(viewer.viewerId);
    expect(res.statusCode).toBe(403);
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(false);
  });
});

describe("plafond MAX_SPEAKERS", () => {
  beforeEach(async () => {
    await setup({ MAX_SPEAKERS: "2" });
  });

  it("grant au-delà du plafond : 409 speakers_full", async () => {
    const first = await newViewer();
    const second = await newViewer();
    const third = await newViewer();
    expect((await grantAs(first.viewerId)).statusCode).toBe(204);
    expect((await grantAs(second.viewerId)).statusCode).toBe(204);
    const refused = await grantAs(third.viewerId);
    expect(refused.statusCode).toBe(409);
    expect(jsonBody(refused)).toMatchObject({ error: "speakers_full" });
    expect(await harness.store.hasSlot(stageSetKey("main"), third.viewerId)).toBe(false);
  });

  it("ré-accorder un speaker déjà présent ne consomme pas de place", async () => {
    const first = await newViewer();
    const second = await newViewer();
    await grantAs(first.viewerId);
    await grantAs(second.viewerId);
    expect((await grantAs(first.viewerId)).statusCode).toBe(204);
  });

  it("une révocation libère une place", async () => {
    const first = await newViewer();
    const second = await newViewer();
    const third = await newViewer();
    await grantAs(first.viewerId);
    await grantAs(second.viewerId);
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    await stageCall("/api/stage/revoke", streamer, { viewerId: first.viewerId });
    expect((await grantAs(third.viewerId)).statusCode).toBe(204);
  });
});

describe("POST /api/stage/revoke", () => {
  beforeEach(async () => {
    await setup();
  });

  it("supprime la clé, appelle updateParticipant (audio coupé) et émet stage:revoked", async () => {
    const viewer = await newViewer();
    await grantAs(viewer.viewerId);
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    const res = await stageCall("/api/stage/revoke", streamer, { viewerId: viewer.viewerId });

    expect(res.statusCode).toBe(204);
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(false);
    // Deux mises à jour : l'octroi (audio permis) puis la révocation (tout coupé).
    expect(harness.livekit.updates.at(-1)).toEqual({
      identity: viewer.viewerId,
      permission: { canPublishAudio: false, canPublishVideo: false },
    });
    expect(harness.notifier.events.at(-1)).toEqual({
      event: "stage:revoked",
      viewerId: viewer.viewerId,
    });
  });

  it("échec SFU : clé supprimée quand même, stage:revoked émis, réponse 502", async () => {
    const viewer = await newViewer();
    await grantAs(viewer.viewerId);
    harness.livekit.failUpdates = new Error("SFU injoignable");
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    const res = await stageCall("/api/stage/revoke", streamer, { viewerId: viewer.viewerId });

    expect(res.statusCode).toBe(502);
    expect(jsonBody(res)).toMatchObject({ error: "sfu_unavailable" });
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(false);
    expect(harness.notifier.events.at(-1)).toEqual({
      event: "stage:revoked",
      viewerId: viewer.viewerId,
    });
    expect(harness.logs()).not.toContain("SFU injoignable");
  });

  it("participant absent du SFU : 204 (rien à couper)", async () => {
    const viewer = await newViewer();
    await grantAs(viewer.viewerId);
    harness.livekit.participantConnected = false;
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    const res = await stageCall("/api/stage/revoke", streamer, { viewerId: viewer.viewerId });
    expect(res.statusCode).toBe(204);
  });

  it("refuse sans cookie streameur (403)", async () => {
    const viewer = await newViewer();
    const res = await stageCall("/api/stage/revoke", undefined, { viewerId: viewer.viewerId });
    expect(res.statusCode).toBe(403);
    expect(harness.livekit.updates).toHaveLength(0);
  });
});

describe("POST /api/stage/request (viewer)", () => {
  beforeEach(async () => {
    await setup();
  });

  it("émet stage:request vers le streameur sans modifier aucun droit", async () => {
    const viewer = await newNamedViewer("Alice_42");
    const viewerCookie = { name: harness.names.viewer, value: viewer.cookie };
    const res = await stageCall("/api/stage/request", viewerCookie, {});
    expect(res.statusCode).toBe(204);
    expect(harness.notifier.events).toEqual([
      { event: "stage:request", viewerId: viewer.viewerId, pseudo: "Alice_42" },
    ]);
    expect(await harness.store.hasSlot(stageSetKey("main"), viewer.viewerId)).toBe(false);
    expect(harness.livekit.updates).toHaveLength(0);
  });

  it("sans identité viewer (cookie streameur seul) : 401", async () => {
    const streamer = { name: harness.names.streamer, value: await streamerCookie() };
    const res = await stageCall("/api/stage/request", streamer, {});
    expect(res.statusCode).toBe(401);
    expect(harness.notifier.events).toHaveLength(0);
  });

  it("refuse un corps non vide : 400", async () => {
    const viewer = await newViewer();
    const res = await stageCall(
      "/api/stage/request",
      { name: harness.names.viewer, value: viewer.cookie },
      { viewerId: viewer.viewerId },
    );
    expect(res.statusCode).toBe(400);
  });

  it("sans pseudo : 400, aucune demande transmise", async () => {
    const viewer = await newViewer();
    const res = await stageCall(
      "/api/stage/request",
      { name: harness.names.viewer, value: viewer.cookie },
      {},
    );
    expect(res.statusCode).toBe(400);
    expect(jsonBody(res).error).toBe("pseudo_required");
    expect(harness.notifier.events).toHaveLength(0);
  });

  it("applique un rate-limit par IP : 429 au-delà du quota", async () => {
    const viewer = await newNamedViewer("Bob_77");
    const viewerCookie = { name: harness.names.viewer, value: viewer.cookie };
    for (let i = 0; i < 5; i += 1) {
      expect((await stageCall("/api/stage/request", viewerCookie, {})).statusCode).toBe(204);
    }
    expect((await stageCall("/api/stage/request", viewerCookie, {})).statusCode).toBe(429);
  });
});
