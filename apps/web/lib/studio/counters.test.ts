import { describe, expect, it } from "vitest";
import { formatSpeakers, isSpeakerCapReached, presenceAgeSeconds } from "./counters";

describe("compteurs studio", () => {
  it("formate les speakers en x/8 avec le plafond partagé", () => {
    expect(formatSpeakers(0)).toBe("0/8");
    expect(formatSpeakers(3)).toBe("3/8");
    expect(formatSpeakers(8)).toBe("8/8");
  });

  it("affiche un tiret tant qu'aucune présence n'est reçue", () => {
    expect(formatSpeakers(null)).toBe("—/8");
  });

  it("ne produit jamais une valeur négative ou fractionnaire", () => {
    expect(formatSpeakers(-2)).toBe("0/8");
    expect(formatSpeakers(2.9)).toBe("2/8");
  });

  it("le plafond est atteint à 8 speakers (bouton Donner désactivé côté UI)", () => {
    expect(isSpeakerCapReached(7)).toBe(false);
    expect(isSpeakerCapReached(8)).toBe(true);
    expect(isSpeakerCapReached(null)).toBe(false);
  });

  it("âge de la dernière présence en secondes entières, null si jamais reçue", () => {
    expect(presenceAgeSeconds(10_000, null)).toBeNull();
    expect(presenceAgeSeconds(10_000, 7_000)).toBe(3);
    expect(presenceAgeSeconds(10_000, 12_000)).toBe(0);
  });
});
