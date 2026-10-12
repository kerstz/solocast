import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WS_CLOSE_CODES } from "@solocast/shared";
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

// Plafond MAX_VIEWERS : une place par viewerId, prise à l'ouverture du chat et par /api/token.
let backend: SharedBackend;
let instance: RunningInstance;
let clients: ChatClient[];

beforeEach(async () => {
  backend = createSharedBackend({ MAX_VIEWERS: "1" });
  clients = [];
  instance = await startInstance(backend);
});

afterEach(async () => {
  for (const client of clients) {
    client.close();
  }
  await instance.app.close();
});

interface Viewer {
  cookie: string;
  viewerId: string;
}

async function newViewer(pseudo: string): Promise<Viewer> {
  const first = await viewerCookie(instance.app, { viewer: backend.names.viewer });
  const cookie = await setPseudo(instance.app, { viewer: backend.names.viewer }, first, pseudo);
  const viewerId = await viewerIdOf(instance.app, cookie, { viewer: backend.names.viewer });
  return { cookie, viewerId };
}

async function connect(cookieHeader: string): Promise<ChatClient> {
  const client = await ChatClient.connect(instance.port, {
    cookie: cookieHeader,
    origin: backend.origin,
  });
  clients.push(client);
  return client;
}

const requestToken = (cookieHeader: string) =>
  instance.app.inject({ method: "POST", url: "/api/token", headers: { cookie: cookieHeader } });

describe("plafond MAX_VIEWERS", () => {
  it("le viewer au-delà du plafond est fermé avec ROOM_FULL et n'entre pas dans la présence", async () => {
    const first = await newViewer("alice");
    const second = await newViewer("bobby");

    const alice = await connect(`${backend.names.viewer}=${first.cookie}`);
    await sleep(50);
    const bobby = await connect(`${backend.names.viewer}=${second.cookie}`);
    await sleep(50);

    expect(bobby.closed?.code).toBe(WS_CLOSE_CODES.ROOM_FULL);
    expect(alice.closed).toBeUndefined();
    const presence = alice.messages.filter((message) => message.type === "presence:update").at(-1);
    expect(presence).toMatchObject({ payload: { count: 1, maxViewers: 1 } });
  });

  it("deux onglets du même viewer ne consomment qu'une place", async () => {
    const viewer = await newViewer("alice");
    const tabOne = await connect(`${backend.names.viewer}=${viewer.cookie}`);
    const tabTwo = await connect(`${backend.names.viewer}=${viewer.cookie}`);
    await sleep(50);

    expect(tabOne.closed).toBeUndefined();
    expect(tabTwo.closed).toBeUndefined();
  });

  it("une place se libère à la déconnexion du dernier onglet", async () => {
    const first = await newViewer("alice");
    const second = await newViewer("bobby");

    const alice = await connect(`${backend.names.viewer}=${first.cookie}`);
    await sleep(50);
    alice.close();
    await sleep(80);

    const bobby = await connect(`${backend.names.viewer}=${second.cookie}`);
    await sleep(50);
    expect(bobby.closed).toBeUndefined();
  });

  it("le streameur ne consomme pas de place viewer", async () => {
    const viewer = await newViewer("alice");
    await connect(`${backend.names.viewer}=${viewer.cookie}`);
    await sleep(50);

    const streamer = await streamerCookieOf(instance.app, backend);
    const studio = await connect(`${backend.names.streamer}=${streamer}`);
    await sleep(50);
    expect(studio.closed).toBeUndefined();
  });

  it("POST /api/token refuse 503 room_full quand le salon est plein", async () => {
    const first = await newViewer("alice");
    const second = await newViewer("bobby");

    const granted = await requestToken(`${backend.names.viewer}=${first.cookie}`);
    expect(granted.statusCode).toBe(200);

    const refused = await requestToken(`${backend.names.viewer}=${second.cookie}`);
    expect(refused.statusCode).toBe(503);
    expect(JSON.parse(refused.body)).toMatchObject({ error: "room_full" });
  });

  it("le même viewer peut redemander un token sans consommer une seconde place", async () => {
    const viewer = await newViewer("alice");
    const header = `${backend.names.viewer}=${viewer.cookie}`;
    expect((await requestToken(header)).statusCode).toBe(200);
    expect((await requestToken(header)).statusCode).toBe(200);
  });
});
