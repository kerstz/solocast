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

const webhookBody = (event: string, identity: string): string =>
  JSON.stringify({ event, room: { name: "main" }, participant: { identity } });

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
