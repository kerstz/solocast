import { describe, expect, it } from "vitest";
import {
  canActOn,
  canGrant,
  INITIAL_SCENE_STATE,
  sceneReducer,
  type SceneAction,
  type SceneState,
} from "./scene";

const A = "1f0e4c2a-3b5d-4e6f-8a7b-9c0d1e2f3a4b";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function run(actions: SceneAction[], from: SceneState = INITIAL_SCENE_STATE): SceneState {
  return actions.reduce(sceneReducer, from);
}

describe("scène : file de demandes", () => {
  it("ajoute une demande reçue, sans doublon", () => {
    const s = run([
      { type: "request_received", viewerId: A, pseudo: "bleu_de_france" },
      { type: "request_received", viewerId: A, pseudo: "bleu_de_france" },
    ]);
    expect(s.requests).toEqual([{ viewerId: A, pseudo: "bleu_de_france" }]);
  });

  it("ignore une demande d'un viewer déjà sur scène", () => {
    const s = run([
      { type: "request_received", viewerId: A, pseudo: "bleu" },
      { type: "action_started", viewerId: A, action: "grant" },
      { type: "grant_succeeded", viewerId: A },
      { type: "request_received", viewerId: A, pseudo: "bleu" },
    ]);
    expect(s.requests).toEqual([]);
    expect(s.speakers).toHaveLength(1);
  });
});

describe("scène : dispatch des actions Donner / Couper / Bannir", () => {
  const queued = [{ type: "request_received", viewerId: A, pseudo: "bleu_de_france" }] as const;

  it("Donner : la demande passe en scène seulement après succès serveur", () => {
    const pending = run([...queued, { type: "action_started", viewerId: A, action: "grant" }]);
    expect(pending.requests).toHaveLength(1);
    expect(pending.speakers).toHaveLength(0);
    expect(pending.busy[A]).toBe("grant");

    const done = sceneReducer(pending, { type: "grant_succeeded", viewerId: A });
    expect(done.requests).toEqual([]);
    expect(done.speakers).toEqual([{ viewerId: A, pseudo: "bleu_de_france" }]);
    expect(done.busy[A]).toBeUndefined();
  });

  it("Donner en échec : rien ne bouge, l'erreur est signalée", () => {
    const failed = run([
      ...queued,
      { type: "action_started", viewerId: A, action: "grant" },
      { type: "action_failed", viewerId: A, action: "grant" },
    ]);
    expect(failed.requests).toHaveLength(1);
    expect(failed.speakers).toHaveLength(0);
    expect(failed.failure).toEqual({ viewerId: A, action: "grant" });
    expect(failed.busy[A]).toBeUndefined();
  });

  it("Couper retire de la scène", () => {
    const s = run([
      ...queued,
      { type: "action_started", viewerId: A, action: "grant" },
      { type: "grant_succeeded", viewerId: A },
      { type: "action_started", viewerId: A, action: "revoke" },
      { type: "revoke_succeeded", viewerId: A },
    ]);
    expect(s.speakers).toEqual([]);
  });

  it("Bannir retire de la file ET de la scène", () => {
    const s = run([
      ...queued,
      { type: "request_received", viewerId: B, pseudo: "citr0n" },
      { type: "action_started", viewerId: A, action: "grant" },
      { type: "grant_succeeded", viewerId: A },
      { type: "action_started", viewerId: A, action: "ban" },
      { type: "ban_succeeded", viewerId: A },
    ]);
    expect(s.speakers).toEqual([]);
    expect(s.requests).toEqual([{ viewerId: B, pseudo: "citr0n" }]);
  });

  it("une seule action à la fois par viewer", () => {
    const s = run([
      ...queued,
      { type: "action_started", viewerId: A, action: "grant" },
      { type: "action_started", viewerId: A, action: "ban" },
    ]);
    expect(s.busy[A]).toBe("grant");
  });

  it("failure_dismissed efface le message d'échec", () => {
    const s = run([
      ...queued,
      { type: "action_failed", viewerId: A, action: "grant" },
      { type: "failure_dismissed" },
    ]);
    expect(s.failure).toBeNull();
  });
});

describe("scène : gardes d'UI (le serveur reste l'autorité)", () => {
  it("Donner est refusé au plafond de speakers ou pendant une action", () => {
    const s = run([{ type: "request_received", viewerId: A, pseudo: "bleu" }]);
    expect(canGrant(s, A, false)).toBe(true);
    expect(canGrant(s, A, true)).toBe(false);
    const busy = sceneReducer(s, { type: "action_started", viewerId: A, action: "grant" });
    expect(canGrant(busy, A, false)).toBe(false);
  });

  it("Couper et Bannir ne sont bloqués que pendant une action sur ce viewer", () => {
    const busy = sceneReducer(INITIAL_SCENE_STATE, {
      type: "action_started",
      viewerId: A,
      action: "revoke",
    });
    expect(canActOn(busy, A)).toBe(false);
    expect(canActOn(busy, B)).toBe(true);
  });
});
