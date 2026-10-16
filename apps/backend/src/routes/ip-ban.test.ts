import { afterEach, describe, expect, it, vi } from "vitest";
import { createIpBans } from "../moderation/ip-ban.js";
import { MemoryKeyValueStore } from "../state/key-value-store.js";
import { cookieFrom, createHarness, jsonBody, type Harness } from "../test/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  vi.useRealTimers();
  await harness?.app.close();
  harness = undefined;
});

const ATTACKER_IP = "203.0.113.50";

async function me(h: Harness, remoteAddress: string, cookie?: string) {
  return h.app.inject({
    method: "GET",
    url: "/api/me",
    remoteAddress,
    ...(cookie === undefined ? {} : { headers: { cookie: `${h.names.viewer}=${cookie}` } }),
  });
}

async function studioCookie(h: Harness): Promise<string> {
  const res = await h.app.inject({ method: "POST", url: "/api/studio/open" });
  return cookieFrom(res.headers["set-cookie"], h.names.streamer);
}

async function ban(h: Harness, viewerId: string, ttlSeconds?: number) {
  return h.app.inject({
    method: "POST",
    url: "/api/moderation/ban",
    payload: ttlSeconds === undefined ? { viewerId } : { viewerId, ttlSeconds },
    headers: { cookie: `${h.names.streamer}=${await studioCookie(h)}` },
  });
}

describe("ban par empreinte d'IP", () => {
  it("un banni qui efface son cookie reste refusé depuis la même IP", async () => {
    harness = await createHarness();
    const first = await me(harness, ATTACKER_IP);
    const viewerId = String(jsonBody(first).viewerId);
    expect((await ban(harness, viewerId)).statusCode).toBe(204);

    const freshIdentity = await me(harness, ATTACKER_IP);
    expect(freshIdentity.statusCode).toBe(403);
    expect(jsonBody(freshIdentity)).toMatchObject({ error: "viewer_banned" });
    expect(freshIdentity.headers["set-cookie"]).toBeUndefined();

    // Un cookie obtenu ailleurs ne permet pas non plus d'obtenir un jeton SFU depuis cette IP.
    const elsewhereCookie = cookieFrom(
      (await me(harness, "198.51.100.9")).headers["set-cookie"],
      harness.names.viewer,
    );
    const token = await harness.app.inject({
      method: "POST",
      url: "/api/token",
      remoteAddress: ATTACKER_IP,
      headers: { cookie: `${harness.names.viewer}=${elsewhereCookie}` },
    });
    expect(token.statusCode).toBe(403);

    // Une autre adresse n'est pas touchée.
    expect((await me(harness, "198.51.100.10")).statusCode).toBe(200);
  });

  it("ne stocke jamais l'IP en clair (empreinte HMAC seulement)", async () => {
    harness = await createHarness();
    const viewerId = String(jsonBody(await me(harness, ATTACKER_IP)).viewerId);
    await ban(harness, viewerId);
    const keys = [
      ...(await harness.store.listKeys("banip:")),
      ...(await harness.store.listKeys("viewerip:")),
    ];
    expect(keys.length).toBe(2);
    for (const key of keys) {
      expect(key).not.toContain(ATTACKER_IP);
      expect(await harness.store.get(key)).not.toContain(ATTACKER_IP);
    }
    expect(harness.logs()).not.toContain(ATTACKER_IP);
  });

  it("borne la durée du ban IP à BAN_IP_TTL_SECONDS, même pour un ban permanent", async () => {
    harness = await createHarness({ BAN_IP_TTL_SECONDS: "60" });
    const first = await me(harness, ATTACKER_IP);
    const viewerId = String(jsonBody(first).viewerId);
    await ban(harness, viewerId);
    expect((await me(harness, ATTACKER_IP)).statusCode).toBe(403);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    // L'IP est libérée ; l'ancien cookie, lui, reste banni (ban permanent par identité).
    expect((await me(harness, ATTACKER_IP)).statusCode).toBe(200);
    const oldCookie = cookieFrom(first.headers["set-cookie"], harness.names.viewer);
    expect((await me(harness, ATTACKER_IP, oldCookie)).statusCode).toBe(403);
  });

  it("ne bannit jamais l'adresse de cette machine (studio, lanceur)", async () => {
    harness = await createHarness();
    const viewerId = String(jsonBody(await me(harness, "127.0.0.1")).viewerId);
    await ban(harness, viewerId);
    expect((await me(harness, "127.0.0.1")).statusCode).toBe(200);
  });
});

describe("createIpBans", () => {
  it("renvoie false quand aucune IP n'est connue pour le viewer", async () => {
    const bans = createIpBans({
      store: new MemoryKeyValueStore(),
      secret: "s".repeat(32),
      maxTtlSeconds: 60,
      rememberTtlSeconds: 60,
    });
    expect(await bans.banViewerIp("inconnu", undefined)).toBe(false);
    expect(await bans.isBanned("::ffff:127.0.0.1")).toBe(false);
  });

  it("dépend du secret : deux déploiements ne produisent pas la même empreinte", async () => {
    const store = new MemoryKeyValueStore();
    const a = createIpBans({
      store,
      secret: "a".repeat(32),
      maxTtlSeconds: 60,
      rememberTtlSeconds: 60,
    });
    const b = createIpBans({
      store,
      secret: "b".repeat(32),
      maxTtlSeconds: 60,
      rememberTtlSeconds: 60,
    });
    await a.remember("v1", ATTACKER_IP);
    await a.banViewerIp("v1", undefined);
    expect(await a.isBanned(ATTACKER_IP)).toBe(true);
    expect(await b.isBanned(ATTACKER_IP)).toBe(false);
  });
});
