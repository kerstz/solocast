import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { STUDIO_SLOT_KEY } from "../auth/streamer-auth.js";
import { createStudioKeyVerifier } from "../auth/studio-key.js";
import { isLoopbackHost, loadConfig } from "../config.js";
import { isLoopbackAddress } from "../http/local-host.js";
import { createTestEnv } from "../test/fakes.js";
import { createHarness, type Harness } from "../test/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

const openWith = (h: Harness, body?: unknown, remoteAddress?: string) =>
  h.app.inject({
    method: "POST",
    url: "/api/studio/open",
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });

describe("configuration de l'accès au studio", () => {
  it("exige STUDIO_KEY par défaut (STUDIO_ACCESS=key)", () => {
    const env = createTestEnv();
    delete env.STUDIO_ACCESS;
    expect(() => loadConfig(env)).toThrow(/STUDIO_KEY/);
  });

  it("refuse une STUDIO_KEY trop courte ou placeholder sans révéler la valeur", () => {
    const attempt = () => loadConfig(createTestEnv({ STUDIO_ACCESS: "key", STUDIO_KEY: "court" }));
    expect(attempt).toThrow(/STUDIO_KEY/);
    expect(attempt).not.toThrow(/court/);
    expect(() =>
      loadConfig(
        createTestEnv({ STUDIO_ACCESS: "key", STUDIO_KEY: `CHANGE_ME_${"x".repeat(40)}` }),
      ),
    ).toThrow(/STUDIO_KEY/);
  });

  it("refuse de démarrer en mode local sur une écoute non-loopback", () => {
    for (const host of ["0.0.0.0", "192.168.1.10", "::", "example.org"]) {
      expect(() =>
        loadConfig(createTestEnv({ STUDIO_ACCESS: "local", BACKEND_HOST: host })),
      ).toThrow(/STUDIO_ACCESS/);
    }
  });

  it("refuse le mode local derrière un reverse-proxy", () => {
    expect(() =>
      loadConfig(createTestEnv({ STUDIO_ACCESS: "local", TRUST_PROXY: "true" })),
    ).toThrow(/STUDIO_ACCESS/);
  });

  it("accepte une écoute réseau avec une clé", () => {
    const config = loadConfig(
      createTestEnv({
        STUDIO_ACCESS: "key",
        STUDIO_KEY: randomBytes(32).toString("hex"),
        BACKEND_HOST: "0.0.0.0",
      }),
    );
    expect(config.STUDIO_ACCESS).toBe("key");
  });

  it("reconnaît les hôtes et adresses loopback", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("localhost.example.org")).toBe(false);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.2")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe("vérification de la clé studio", () => {
  it("compare en temps constant et refuse vide, absent ou faux", () => {
    const key = randomBytes(32).toString("hex");
    const verify = createStudioKeyVerifier(key);
    expect(verify(key)).toBe(true);
    expect(verify(`${key}x`)).toBe(false);
    expect(verify("")).toBe(false);
    expect(verify(undefined)).toBe(false);
  });
});

describe("POST /api/studio/open en mode clé", () => {
  const key = randomBytes(32).toString("hex");

  it("refuse l'ouverture sans clé ou avec une mauvaise clé (401), sans prendre la place", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "key", STUDIO_KEY: key });
    const missing = await openWith(harness);
    expect(missing.statusCode).toBe(401);
    expect(JSON.parse(missing.body)).toMatchObject({ error: "studio_key_required" });
    const wrong = await openWith(harness, { key: "mauvaise-cle" });
    expect(wrong.statusCode).toBe(401);
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(0);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
  });

  it("ouvre le studio avec la bonne clé, même depuis le réseau", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "key", STUDIO_KEY: key });
    const res = await openWith(harness, { key }, "192.168.1.20");
    expect(res.statusCode).toBe(204);
    expect(await harness.store.countSlots(STUDIO_SLOT_KEY)).toBe(1);
  });

  it("ne journalise jamais la clé studio", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "key", STUDIO_KEY: key });
    await openWith(harness, { key: "mauvaise-cle" });
    await openWith(harness, { key });
    expect(harness.logs()).not.toContain(key);
    expect(harness.logs()).not.toContain("mauvaise-cle");
  });

  it("refuse une clé trop longue (400)", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "key", STUDIO_KEY: key });
    const res = await openWith(harness, { key: "x".repeat(300) });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/studio/open en mode local", () => {
  it("refuse une connexion réseau même avec un Host forgé à localhost", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "local" });
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      remoteAddress: "192.168.1.30",
      headers: { host: "localhost:3000" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: "studio_local_only" });
  });

  it("refuse un Host non local même depuis loopback (proxy, rebinding DNS)", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "local" });
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      remoteAddress: "127.0.0.1",
      headers: { host: "evil.example.org" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepte une requête de cette machine, sans clé", async () => {
    harness = await createHarness({ STUDIO_ACCESS: "local" });
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:3000" },
    });
    expect(res.statusCode).toBe(204);
  });
});
