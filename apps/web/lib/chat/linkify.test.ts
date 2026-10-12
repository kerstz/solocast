import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

describe("linkify", () => {
  it("renvoie le texte tel quel sans lien", () => {
    expect(linkify("bonjour <b>tout le monde</b>")).toEqual([
      { kind: "text", value: "bonjour <b>tout le monde</b>" },
    ]);
  });

  it("transforme une URL https en lien et garde la ponctuation finale en texte", () => {
    expect(linkify("voir https://example.com/guest, merci")).toEqual([
      { kind: "text", value: "voir " },
      { kind: "link", value: "https://example.com/guest", href: "https://example.com/guest" },
      { kind: "text", value: ", merci" },
    ]);
  });

  it("ne transforme jamais un schéma non http(s) en lien", () => {
    const segments = linkify("javascript:alert(1) et data:text/html,x");
    expect(segments.every((s) => s.kind === "text")).toBe(true);
  });
});
