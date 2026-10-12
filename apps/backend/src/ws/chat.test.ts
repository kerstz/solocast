import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { banKey } from "../auth/viewer-identity.js";
import { stageSetKey } from "../stage/stage-registry.js";
import {
  ChatClient,
  createSharedBackend,
  setPseudo,
  sleep,
  startInstance,
  streamerCookieOf,
  viewerCookie,
  viewerIdOf,
  type RunningInstance,
  type SharedBackend,
} from "../test/ws-harness.js";

let backend: SharedBackend;
let instances: RunningInstance[];
let clients: ChatClient[];

beforeEach(async () => {
  backend = createSharedBackend();
  instances = [];
  clients = [];
  instances.push(await startInstance(backend));
  instances.push(await startInstance(backend));
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  for (const instance of instances) {
    await instance.app.close();
  }
});

interface Viewer {
  cookie: string;
  viewerId: string;
  instance: RunningInstance;
}

// Crée un viewer sur une instance donnée : cookie viewer + pseudo (PUT /api/me/pseudo, WP1).
async function newViewer(instance: RunningInstance, pseudo: string): Promise<Viewer> {
  const first = await viewerCookie(instance.app, { viewer: backend.names.viewer });
  const cookie = await setPseudo(instance.app, { viewer: backend.names.viewer }, first, pseudo);
  const viewerId = await viewerIdOf(instance.app, cookie, { viewer: backend.names.viewer });
  return { cookie, viewerId, instance };
}

async function connect(viewer: Viewer): Promise<ChatClient> {
  const client = await ChatClient.connect(viewer.instance.port, {
    cookie: `${backend.names.viewer}=${viewer.cookie}`,
    origin: backend.origin,
  });
  clients.push(client);
  return client;
}

async function connectStreamer(instance: RunningInstance, cookie: string): Promise<ChatClient> {
  const client = await ChatClient.connect(instance.port, {
    cookie: `${backend.names.streamer}=${cookie}`,
    origin: backend.origin,
  });
  clients.push(client);
  return client;
}

describe("chat WebSocket : diffusion multi-instance", () => {
  it("deux clients sur deux instances voient les messages l'un de l'autre", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const bob = await newViewer(instances[1] as RunningInstance, "bobby");
    const aliceWs = await connect(alice);
    const bobWs = await connect(bob);

    await aliceWs.waitFor((m) => m.type === "chat:history");
    aliceWs.send({ type: "chat:send", payload: { text: "bonjour" } });
    const seenByBob = await bobWs.waitFor(
      (m) => m.type === "chat:message" && m.payload.text === "bonjour",
    );
    expect(seenByBob).toMatchObject({
      payload: { pseudo: "alice", userId: alice.viewerId, isStreamer: false },
    });
    await aliceWs.waitFor((m) => m.type === "chat:message" && m.payload.text === "bonjour");

    bobWs.send({ type: "chat:send", payload: { text: "salut" } });
    await aliceWs.waitFor((m) => m.type === "chat:message" && m.payload.text === "salut");
  });

  it("l'historique est renvoyé à la connexion, et la présence est diffusée", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const bob = await newViewer(instances[1] as RunningInstance, "bobby");
    const aliceWs = await connect(alice);
    aliceWs.send({ type: "chat:send", payload: { text: "premier" } });
    await aliceWs.waitFor((m) => m.type === "chat:message");

    const bobWs = await connect(bob);
    const history = await bobWs.waitFor((m) => m.type === "chat:history");
    expect(history).toMatchObject({ payload: [expect.objectContaining({ text: "premier" })] });
    const presence = await bobWs.waitFor(
      (m) => m.type === "presence:update" && m.payload.count === 2,
    );
    expect(presence).toMatchObject({
      payload: { pseudos: ["alice", "bobby"], live: false, speakers: 0 },
    });
  });

  it("la présence retire un viewer déconnecté", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const bob = await newViewer(instances[1] as RunningInstance, "bobby");
    const aliceWs = await connect(alice);
    const bobWs = await connect(bob);
    await bobWs.waitFor((m) => m.type === "presence:update" && m.payload.count === 2);

    aliceWs.close();
    await bobWs.waitFor((m) => m.type === "presence:update" && m.payload.count === 1);
  });
});

describe("chat WebSocket : rate-limit, flood et validation", () => {
  it("flood : rejets signalés par system:notice, puis fermeture 4008 ; pas de déconnexion avant", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");

    for (let i = 0; i < 23; i += 1) {
      aliceWs.send({ type: "chat:send", payload: { text: `msg ${String(i)}` } });
    }
    await aliceWs.waitFor(
      (m) => m.type === "system:notice" && m.payload.message.startsWith("Too many messages"),
    );
    const closed = await aliceWs.waitClosed();
    expect(closed.code).toBe(4008);
    const accepted = aliceWs.messages.filter((m) => m.type === "chat:message");
    expect(accepted).toHaveLength(3);
  });

  it("le rate-limit ne coupe pas une connexion qui reste sous le seuil", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");
    for (let i = 0; i < 3; i += 1) {
      aliceWs.send({ type: "chat:send", payload: { text: `ok ${String(i)}` } });
    }
    await aliceWs.waitFor((m) => m.type === "chat:message" && m.payload.text === "ok 2");
    await sleep(50);
    expect(aliceWs.closed).toBeUndefined();
  });

  it("message invalide (HTML, champ en trop, JSON cassé) : notice, aucune diffusion", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const bob = await newViewer(instances[1] as RunningInstance, "bobby");
    const aliceWs = await connect(alice);
    const bobWs = await connect(bob);
    await bobWs.waitFor((m) => m.type === "chat:history");

    aliceWs.send({ type: "chat:send", payload: { text: "<img src=x onerror=alert(1)>" } });
    await aliceWs.waitFor((m) => m.type === "system:notice");
    aliceWs.send({ type: "chat:send", payload: { text: "ok", color: "#000" } });
    aliceWs.sendRaw("{pas du json");
    await sleep(100);

    expect(bobWs.messages.some((m) => m.type === "chat:message")).toBe(false);
    expect(aliceWs.closed).toBeUndefined();
  });

  it("un viewer sans pseudo ne peut pas écrire", async () => {
    const first = await viewerCookie(instances[0]?.app as FastifyInstance, {
      viewer: backend.names.viewer,
    });
    const viewerId = await viewerIdOf(instances[0]?.app as FastifyInstance, first, {
      viewer: backend.names.viewer,
    });
    const aliceWs = await connect({
      cookie: first,
      viewerId,
      instance: instances[0] as RunningInstance,
    });
    await aliceWs.waitFor((m) => m.type === "chat:history");
    aliceWs.send({ type: "chat:send", payload: { text: "bonjour" } });
    await aliceWs.waitFor(
      (m) => m.type === "system:notice" && m.payload.message.includes("username"),
    );
  });
});

describe("chat WebSocket : refus avant upgrade", () => {
  it("origine non autorisée : 403 sans WS", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const status = await ChatClient.refused((instances[0] as RunningInstance).port, {
      cookie: `${backend.names.viewer}=${alice.cookie}`,
      origin: "http://evil.test",
    });
    expect(status).toBe(403);
  });

  it("origine absente : 403", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const status = await ChatClient.refused((instances[0] as RunningInstance).port, {
      cookie: `${backend.names.viewer}=${alice.cookie}`,
    });
    expect(status).toBe(403);
  });

  it("sans cookie valide : 401 avant upgrade", async () => {
    const status = await ChatClient.refused((instances[0] as RunningInstance).port, {
      origin: backend.origin,
    });
    expect(status).toBe(401);
  });

  it("viewer banni : refus de la reconnexion (403)", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    await backend.store.set(banKey(alice.viewerId), "1", null);
    const status = await ChatClient.refused((instances[0] as RunningInstance).port, {
      cookie: `${backend.names.viewer}=${alice.cookie}`,
      origin: backend.origin,
    });
    expect(status).toBe(403);
  });
});

describe("modération : ban", () => {
  it("ban : WS fermé (4003) sur l'autre instance, updateParticipant + removeParticipant, reconnexion refusée", async () => {
    const alice = await newViewer(instances[1] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");
    const streamer = await streamerCookieOf((instances[0] as RunningInstance).app, backend);

    const res = await (instances[0] as RunningInstance).app.inject({
      method: "POST",
      url: "/api/moderation/ban",
      payload: { viewerId: alice.viewerId, reason: "spam" },
      headers: { cookie: `${backend.names.streamer}=${streamer}` },
    });
    expect(res.statusCode).toBe(204);

    const closed = await aliceWs.waitClosed();
    expect(closed.code).toBe(4003);
    expect(backend.livekit.updates).toEqual([
      {
        identity: alice.viewerId,
        permission: { canPublishAudio: false, canPublishVideo: false },
      },
    ]);
    expect(backend.livekit.removals).toEqual([alice.viewerId]);

    const refused = await ChatClient.refused((instances[1] as RunningInstance).port, {
      cookie: `${backend.names.viewer}=${alice.cookie}`,
      origin: backend.origin,
    });
    expect(refused).toBe(403);
    const token = await (instances[1] as RunningInstance).app.inject({
      method: "POST",
      url: "/api/token",
      headers: { cookie: `${backend.names.viewer}=${alice.cookie}` },
    });
    expect(token.statusCode).toBe(403);
  });

  it("ban refusé sans cookie streameur (403) : aucun effet", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");
    const res = await (instances[0] as RunningInstance).app.inject({
      method: "POST",
      url: "/api/moderation/ban",
      payload: { viewerId: alice.viewerId },
    });
    expect(res.statusCode).toBe(403);
    expect(backend.livekit.removals).toHaveLength(0);
    expect(await backend.store.exists(banKey(alice.viewerId))).toBe(false);
  });
});

describe("parole : isolation des événements stage", () => {
  it("stage:granted ne va qu'au viewer ciblé ; stage:request ne va qu'au streameur ; stage:leave révoque", async () => {
    const streamerCookie = await streamerCookieOf((instances[0] as RunningInstance).app, backend);
    const streamerWs = await connectStreamer(instances[0] as RunningInstance, streamerCookie);
    const alice = await newViewer(instances[1] as RunningInstance, "alice");
    const bob = await newViewer(instances[0] as RunningInstance, "bobby");
    const aliceWs = await connect(alice);
    const bobWs = await connect(bob);
    await aliceWs.waitFor((m) => m.type === "chat:history");
    await bobWs.waitFor((m) => m.type === "chat:history");

    const grant = await (instances[0] as RunningInstance).app.inject({
      method: "POST",
      url: "/api/stage/grant",
      payload: { viewerId: alice.viewerId },
      headers: { cookie: `${backend.names.streamer}=${streamerCookie}` },
    });
    expect(grant.statusCode).toBe(204);
    await aliceWs.waitFor((m) => m.type === "stage:granted");
    await sleep(100);
    expect(bobWs.messages.some((m) => m.type === "stage:granted")).toBe(false);

    bobWs.send({ type: "stage:request" });
    const request = await streamerWs.waitFor((m) => m.type === "stage:request");
    expect(request).toMatchObject({ payload: { viewerId: bob.viewerId, pseudo: "bobby" } });
    await sleep(50);
    expect(aliceWs.messages.some((m) => m.type === "stage:request")).toBe(false);
    expect(bobWs.messages.some((m) => m.type === "stage:request")).toBe(false);

    aliceWs.send({ type: "stage:leave" });
    await aliceWs.waitFor((m) => m.type === "stage:revoked");
    expect(backend.livekit.updates.at(-1)).toEqual({
      identity: alice.viewerId,
      permission: { canPublishAudio: false, canPublishVideo: false },
    });
    expect(await backend.store.hasSlot(stageSetKey("main"), alice.viewerId)).toBe(false);
    expect(bobWs.messages.some((m) => m.type === "stage:revoked")).toBe(false);
  });

  it("fermer le dernier onglet rend la place de parole (pas d'attente de l'expiration du grant)", async () => {
    const streamerCookie = await streamerCookieOf((instances[0] as RunningInstance).app, backend);
    const alice = await newViewer(instances[1] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");

    const grant = await (instances[0] as RunningInstance).app.inject({
      method: "POST",
      url: "/api/stage/grant",
      payload: { viewerId: alice.viewerId },
      headers: { cookie: `${backend.names.streamer}=${streamerCookie}` },
    });
    expect(grant.statusCode).toBe(204);
    await aliceWs.waitFor((m) => m.type === "stage:granted");
    expect(await backend.store.countSlots(stageSetKey("main"))).toBe(1);

    // Fermeture brutale : aucun stage:leave n'est envoyé.
    aliceWs.close();
    await sleep(200);

    expect(await backend.store.hasSlot(stageSetKey("main"), alice.viewerId)).toBe(false);
    expect(await backend.store.countSlots(stageSetKey("main"))).toBe(0);
    // Le SFU a bien été coupé, pas seulement l'état serveur.
    expect(backend.livekit.updates.at(-1)).toEqual({
      identity: alice.viewerId,
      permission: { canPublishAudio: false, canPublishVideo: false },
    });
  });

  it("un viewer sans parole ne déclenche aucun appel SFU en se déconnectant", async () => {
    const bob = await newViewer(instances[0] as RunningInstance, "bobby");
    const bobWs = await connect(bob);
    await bobWs.waitFor((m) => m.type === "chat:history");
    const before = backend.livekit.updates.length;

    bobWs.close();
    await sleep(200);

    expect(backend.livekit.updates.length).toBe(before);
  });

  it("les logs n'contiennent ni le texte du chat ni de secret", async () => {
    const alice = await newViewer(instances[0] as RunningInstance, "alice");
    const aliceWs = await connect(alice);
    await aliceWs.waitFor((m) => m.type === "chat:history");
    aliceWs.send({ type: "chat:send", payload: { text: "phrase-secrete-de-test" } });
    await aliceWs.waitFor((m) => m.type === "chat:message");
    const logs = backend.sink.join("");
    expect(logs).toContain("chat.message");
    expect(logs).not.toContain("phrase-secrete-de-test");
    expect(logs).not.toContain(alice.cookie);
  });
});
