import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";
import { createTestEnv } from "./test/fakes.js";

describe("loadConfig", () => {
  it("accepte un environnement valide et normalise CORS_ORIGIN", () => {
    const config = loadConfig(createTestEnv({ CORS_ORIGIN: "http://localhost:3001/" }));
    expect(config.CORS_ORIGIN).toEqual(["http://localhost:3001"]);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it("accepte plusieurs origines séparées par des virgules", () => {
    const config = loadConfig(
      createTestEnv({ CORS_ORIGIN: "http://localhost:8080, https://abc.trycloudflare.com/" }),
    );
    expect(config.CORS_ORIGIN).toEqual(["http://localhost:8080", "https://abc.trycloudflare.com"]);
  });

  it("accepte un chemin same-origin pour LIVEKIT_PUBLIC_WS_URL", () => {
    const config = loadConfig(createTestEnv({ LIVEKIT_PUBLIC_WS_URL: "/" }));
    expect(config.LIVEKIT_PUBLIC_WS_URL).toBe("/");
  });

  it("rejette un JWT_SECRET de moins de 32 octets sans révéler la valeur", () => {
    const short = "abc123";
    const attempt = () => loadConfig(createTestEnv({ JWT_SECRET: short }));
    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/JWT_SECRET/);
    expect(attempt).not.toThrow(new RegExp(short));
  });

  it("rejette les valeurs placeholder CHANGE_ME de .env.example", () => {
    const placeholder = `CHANGE_ME_${"x".repeat(40)}`;
    expect(() => loadConfig(createTestEnv({ JWT_SECRET: placeholder }))).toThrow(/JWT_SECRET/);
  });

  it("impose COOKIE_SECURE=true en production", () => {
    expect(() =>
      loadConfig(createTestEnv({ NODE_ENV: "production", COOKIE_SECURE: "false" })),
    ).toThrow(/COOKIE_SECURE/);
  });

  it("refuse CORS '*' et une origine avec chemin", () => {
    expect(() => loadConfig(createTestEnv({ CORS_ORIGIN: "*" }))).toThrow(/CORS_ORIGIN/);
    expect(() => loadConfig(createTestEnv({ CORS_ORIGIN: "http://localhost:3001/app" }))).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it("refuse un JWT_SECRET trop court sans révéler la valeur", () => {
    const attempt = () => loadConfig(createTestEnv({ JWT_SECRET: "trop-court" }));
    expect(attempt).toThrow(/JWT_SECRET/);
    expect(attempt).not.toThrow(/trop-court/);
  });

  it("exige JWT_SECRET (aucun défaut : aucune session signée par omission)", () => {
    const env = createTestEnv();
    delete env.JWT_SECRET;
    expect(() => loadConfig(env)).toThrow(/JWT_SECRET/);
  });

  it("refuse deux cookies de même nom", () => {
    expect(() =>
      loadConfig(createTestEnv({ SESSION_COOKIE_NAME: "same", VIEWER_COOKIE_NAME: "same" })),
    ).toThrow(/VIEWER_COOKIE_NAME/);
  });

  it("applique les défauts LiveKit : MAX_SPEAKERS=8, TTL token 600 s", () => {
    const env = createTestEnv();
    delete env.MAX_SPEAKERS;
    delete env.LIVEKIT_TOKEN_TTL_SECONDS;
    const config = loadConfig(env);
    expect(config.MAX_SPEAKERS).toBe(8);
    expect(config.LIVEKIT_TOKEN_TTL_SECONDS).toBe(600);
    expect(config.ROOM_NAME).toBe("main");
  });

  it("refuse une room autre que 'main' (V1 : room fixe)", () => {
    expect(() => loadConfig(createTestEnv({ ROOM_NAME: "autre" }))).toThrow(/ROOM_NAME/);
  });

  it("refuse un LIVEKIT_API_SECRET de moins de 32 octets sans révéler la valeur", () => {
    const attempt = () => loadConfig(createTestEnv({ LIVEKIT_API_SECRET: "courte" }));
    expect(attempt).toThrow(/LIVEKIT_API_SECRET/);
    expect(attempt).not.toThrow(/courte/);
  });

  it("exige une URL WebSocket publique ws(s) et une URL API http(s)", () => {
    expect(() => loadConfig(createTestEnv({ LIVEKIT_PUBLIC_WS_URL: "http://x.test" }))).toThrow(
      /LIVEKIT_PUBLIC_WS_URL/,
    );
    expect(() => loadConfig(createTestEnv({ LIVEKIT_URL: "ws://x.test" }))).toThrow(/LIVEKIT_URL/);
  });

  it("refuse MAX_SPEAKERS négatif et un TTL token hors bornes", () => {
    expect(() => loadConfig(createTestEnv({ MAX_SPEAKERS: "-1" }))).toThrow(/MAX_SPEAKERS/);
    expect(() => loadConfig(createTestEnv({ LIVEKIT_TOKEN_TTL_SECONDS: "5" }))).toThrow(
      /LIVEKIT_TOKEN_TTL_SECONDS/,
    );
  });
});
