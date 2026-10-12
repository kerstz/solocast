import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./test/harness.js";

function makeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), "solocast-web-"));
  mkdirSync(join(dir, "watch"));
  writeFileSync(join(dir, "index.html"), "<h1>accueil</h1>");
  writeFileSync(join(dir, "watch", "index.html"), "<h1>watch</h1>");
  writeFileSync(join(dir, "404.html"), "<h1>perdu</h1>");
  return dir;
}

describe("front statique", () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    await harness?.app.close();
    harness = undefined;
  });

  it("sert les pages exportées et garde l'API intacte", async () => {
    harness = await createHarness({}, { staticDir: makeSite() });
    const home = await harness.app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("accueil");
    expect(home.headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");

    const watch = await harness.app.inject({ method: "GET", url: "/watch/" });
    expect(watch.body).toContain("watch");

    const health = await harness.app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ status: "ok" });

    const missing = await harness.app.inject({ method: "GET", url: "/nope" });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain("perdu");

    const apiMissing = await harness.app.inject({ method: "GET", url: "/api/nope" });
    expect(apiMissing.statusCode).toBe(404);
    expect(apiMissing.json()).toMatchObject({ error: "not_found" });
  });
});

describe("studioLocalOnly", () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    await harness?.app.close();
    harness = undefined;
  });

  it("refuse l'ouverture du studio depuis une adresse publique", async () => {
    harness = await createHarness({}, { studioLocalOnly: true });
    const remote = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      headers: { host: "random-words.trycloudflare.com" },
      payload: {},
    });
    expect(remote.statusCode).toBe(403);
    expect(remote.json()).toMatchObject({ error: "studio_local_only" });

    const local = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      headers: { host: "localhost:8080" },
      payload: {},
    });
    expect(local.statusCode).toBe(204);
  });
});

describe("anti-CSRF", () => {
  let harness: Harness | undefined;
  afterEach(async () => {
    await harness?.app.close();
    harness = undefined;
  });

  it("refuse une écriture venue d'une autre origine, accepte la sienne et les clients sans Origin", async () => {
    harness = await createHarness();
    const post = (headers: Record<string, string>) =>
      harness?.app.inject({ method: "POST", url: "/api/studio/open", headers, payload: {} });

    expect((await post({ origin: "https://evil.example" }))?.statusCode).toBe(403);
    expect((await post({ "sec-fetch-site": "cross-site" }))?.statusCode).toBe(403);
    expect((await post({ origin: "http://localhost:3001" }))?.statusCode).toBe(204);
    expect((await post({}))?.statusCode).toBe(204);
  });
});
