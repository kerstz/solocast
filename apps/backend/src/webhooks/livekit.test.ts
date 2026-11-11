import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { SignJWT } from "jose";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createMemoryChatServices, type ChatServices } from "../chat/services.js";
import { loadConfig } from "../config.js";
import { createSharedBackend, type SharedBackend } from "../test/ws-harness.js";
import { STREAMER_IDENTITY } from "../livekit/grants.js";
import { SFU_STREAMER_LINK_ID } from "../chat/hub.js";
import { banKey } from "../auth/viewer-identity.js";
import { stageSetKey } from "../stage/stage-registry.js";

// Signature LiveKit : JWT HS256 (iss = clé API, exp requis) portant sha256 = base64(SHA-256(corps)).
async function signedAuthorization(
  body: string,
  secret: string,
  apiKey: string,
  wrongSecret = false,
): Promise<string> {
  const sha256 = createHash("sha256").update(body, "utf8").digest("base64");
  return new SignJWT({ sha256 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setIssuedAt()
    .setNotBefore(0)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(wrongSecret ? `${secret}x` : secret));
}

let backend: SharedBackend;
let app: FastifyInstance;
let chat: ChatServices;

beforeEach(async () => {
  backend = createSharedBackend();
  chat = createMemoryChatServices({ historySize: 200 });
  app = await buildApp({
    config: loadConfig(backend.env),
    store: backend.store,
    logStream: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        backend.sink.push(chunk.toString("utf8"));
        callback();
      },
    }),
    livekit: backend.livekit,
    chat,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const webhookBody = (event: string, identity: string, canPublish?: boolean): string =>
  JSON.stringify({
    event,
    room: { name: "main" },
    participant: {
      identity,
      ...(canPublish === undefined ? {} : { permission: { canPublish } }),
    },
  });

async function signedPost(body: string) {
  return post(
    body,
    await signedAuthorization(
      body,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    ),
  );
}

async function post(body: string, authorization: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/webhooks/livekit",
    headers: {
      "content-type": "application/webhook+json",
      ...(authorization === undefined ? {} : { authorization }),
    },
    payload: body,
  });
}

describe("POST /webhooks/livekit : signature", () => {
  it("signature invalide (mauvaise clé) : 401", async () => {
    const body = webhookBody("participant_joined", "viewer-x");
    const auth = await signedAuthorization(
      body,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
      true,
    );
    const res = await post(body, auth);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: "invalid_signature" });
  });

  it("corps altéré après signature : 401", async () => {
    const signedBody = webhookBody("participant_joined", "viewer-x");
    const auth = await signedAuthorization(
      signedBody,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    );
    const res = await post(webhookBody("participant_joined", "autre"), auth);
    expect(res.statusCode).toBe(401);
  });

  it("en-tête Authorization absent : 401", async () => {
    const res = await post(webhookBody("participant_left", "viewer-x"), undefined);
    expect(res.statusCode).toBe(401);
  });

  it("signature valide : 200 et événement traité", async () => {
    const body = webhookBody("participant_joined", STREAMER_IDENTITY);
    const auth = await signedAuthorization(
      body,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    );
    const res = await post(body, auth);
    expect(res.statusCode).toBe(200);
    expect(backend.sink.join("")).toContain("sfu.participant_joined");
  });
});

describe("POST /webhooks/livekit : présence streameur côté SFU", () => {
  it("participant 'streamer' joined puis left met à jour le lien de présence (live)", async () => {
    const joined = webhookBody("participant_joined", STREAMER_IDENTITY);
    const joinedAuth = await signedAuthorization(
      joined,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    );
    expect((await post(joined, joinedAuth)).statusCode).toBe(200);
    expect(await chat.state.hasStreamerLink(SFU_STREAMER_LINK_ID)).toBe(true);

    const left = webhookBody("participant_left", STREAMER_IDENTITY);
    const leftAuth = await signedAuthorization(
      left,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    );
    expect((await post(left, leftAuth)).statusCode).toBe(200);
    expect(await chat.state.hasStreamerLink(SFU_STREAMER_LINK_ID)).toBe(false);
  });

  it("un viewer n'affecte pas le lien de présence du streameur", async () => {
    const body = webhookBody("participant_joined", "6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6");
    const auth = await signedAuthorization(
      body,
      backend.env.LIVEKIT_API_SECRET ?? "",
      backend.env.LIVEKIT_API_KEY ?? "",
    );
    expect((await post(body, auth)).statusCode).toBe(200);
    expect(await chat.state.hasStreamerLink(SFU_STREAMER_LINK_ID)).toBe(false);
  });
});

describe("POST /webhooks/livekit : rejoin avec un jeton périmé", () => {
  const viewerId = "6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6";

  it("viewer banni qui rejoint le SFU avec son ancien jeton : retiré de la room", async () => {
    await backend.store.set(banKey(viewerId), "1", null);
    expect((await signedPost(webhookBody("participant_joined", viewerId, false))).statusCode).toBe(
      200,
    );
    expect(backend.livekit.removals).toEqual([viewerId]);
  });

  it("viewer sans droit de parole qui rejoint avec un jeton publiant : droits retirés", async () => {
    expect((await signedPost(webhookBody("participant_joined", viewerId, true))).statusCode).toBe(
      200,
    );
    expect(backend.livekit.removals).toEqual([]);
    expect(backend.livekit.updates).toHaveLength(1);
    expect(backend.livekit.updates[0]).toMatchObject({
      identity: viewerId,
      permission: { canPublishAudio: false, canPublishVideo: false },
    });
  });

  it("speaker légitime ou viewer passif : aucune action", async () => {
    await backend.store.takeSlot(stageSetKey("main"), viewerId, 600, 8);
    await signedPost(webhookBody("participant_joined", viewerId, true));
    await signedPost(webhookBody("participant_joined", viewerId, false));
    expect(backend.livekit.updates).toEqual([]);
    expect(backend.livekit.removals).toEqual([]);
  });

  it("identité non viewer (ingress, inconnue) : ignorée", async () => {
    await signedPost(webhookBody("participant_joined", "ingress-abc", true));
    expect(backend.livekit.updates).toEqual([]);
    expect(backend.livekit.removals).toEqual([]);
  });

  it("SFU en panne pendant le contrôle : le webhook répond 200 et l'échec est journalisé", async () => {
    await backend.store.set(banKey(viewerId), "1", null);
    backend.livekit.participantConnected = true;
    backend.livekit.removeParticipant = () => Promise.reject(new Error("sfu down"));
    expect((await signedPost(webhookBody("participant_joined", viewerId, false))).statusCode).toBe(
      200,
    );
    expect(backend.sink.join("")).toContain("sfu.join_guard_failed");
  });
});
