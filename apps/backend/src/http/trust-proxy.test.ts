import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { cookieFrom, createHarness, jsonBody, type Harness } from "../test/harness.js";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.close();
  harness = undefined;
});

const proxied = (extra: Record<string, string> = {}) => ({
  TRUST_PROXY: "true",
  STUDIO_ACCESS: "key",
  STUDIO_KEY: randomBytes(32).toString("hex"),
  ...extra,
});

// Le reverse-proxy (Caddy) ajoute l'adresse qu'il voit à DROITE de X-Forwarded-For ; ce que le
// client y a écrit avant reste à gauche et ne doit jamais compter.
function me(h: Harness, forwardedFor: string) {
  return h.app.inject({
    method: "GET",
    url: "/api/me",
    remoteAddress: "10.0.0.2",
    headers: { "x-forwarded-for": forwardedFor },
  });
}

describe("TRUST_PROXY : adresse client", () => {
  it("un X-Forwarded-For forgé ne contourne pas le ban par IP", async () => {
    const env = proxied();
    harness = await createHarness(env);
    const first = await me(harness, "198.51.100.1, 203.0.113.50");
    const viewerId = String(jsonBody(first).viewerId);
    const open = await harness.app.inject({
      method: "POST",
      url: "/api/studio/open",
      payload: { key: env.STUDIO_KEY },
    });
    const streamer = cookieFrom(open.headers["set-cookie"], harness.names.streamer);
    const ban = await harness.app.inject({
      method: "POST",
      url: "/api/moderation/ban",
      payload: { viewerId },
      headers: { cookie: `${harness.names.streamer}=${streamer}` },
    });
    expect(ban.statusCode).toBe(204);

    // Même adresse réelle (celle vue par le proxy), adresse de tête changée : toujours banni.
    expect((await me(harness, "192.0.2.77, 203.0.113.50")).statusCode).toBe(403);
    // Autre adresse réelle, même adresse de tête que le banni : pas banni.
    expect((await me(harness, "198.51.100.1, 203.0.113.99")).statusCode).toBe(200);
  });
});

describe("quota par IP : préfixe /64 en IPv6", () => {
  it("changer de suffixe IPv6 dans le même /64 ne donne pas un nouveau quota", async () => {
    harness = await createHarness(proxied({ STUDIO_RATE_LIMIT_MAX: "2" }));
    const open = (suffix: string, prefix = "2001:db8:1:2") =>
      harness?.app.inject({
        method: "POST",
        url: "/api/studio/open",
        remoteAddress: "10.0.0.2",
        headers: { "x-forwarded-for": `${prefix}::${suffix}` },
        payload: { key: "mauvaise-cle" },
      });
    expect((await open("1"))?.statusCode).toBe(401);
    expect((await open("2"))?.statusCode).toBe(401);
    expect((await open("3"))?.statusCode).toBe(429);
    // Autre /64 : quota à part.
    expect((await open("1", "2001:db8:1:9"))?.statusCode).toBe(401);
  });
});
