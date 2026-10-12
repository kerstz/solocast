import { describe, expect, it } from "vitest";
import { resolveLivekitUrl } from "./livekitUrl";

describe("resolveLivekitUrl", () => {
  it("laisse une URL ws(s) inchangée", () => {
    expect(resolveLivekitUrl("wss://live.example.test", { protocol: "http:", host: "a:1" })).toBe(
      "wss://live.example.test",
    );
  });

  it("résout un chemin contre l'origine de la page", () => {
    expect(resolveLivekitUrl("/", { protocol: "http:", host: "localhost:8080" })).toBe(
      "ws://localhost:8080/",
    );
    expect(resolveLivekitUrl("/", { protocol: "https:", host: "x.trycloudflare.com" })).toBe(
      "wss://x.trycloudflare.com/",
    );
  });
});
