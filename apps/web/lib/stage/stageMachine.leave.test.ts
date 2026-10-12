import { describe, expect, it } from "vitest";
import { INITIAL_STAGE_STATE, isActive, stageReducer, type StageState } from "./stageMachine";

describe("sortie volontaire de scène : confirmée par stage:revoked", () => {
  it("LEAVE depuis l'antenne passe en stopping et y reste jusqu'à REVOKED", () => {
    let s: StageState = { phase: "on_air" };
    s = stageReducer(s, { type: "LEAVE" });
    expect(s.phase).toBe("stopping");
    // Le hook n'émet pas DISCONNECTED pour une sortie volontaire (garde isCurrent) : seul REVOKED libère.
    s = stageReducer(s, { type: "REVOKED" });
    expect(s.phase).toBe("idle");
  });

  it("REVOKED reçu pendant stopping libère l'état", () => {
    expect(stageReducer({ phase: "stopping" }, { type: "REVOKED" }).phase).toBe("idle");
  });

  it("LEAVE hors antenne est sans effet", () => {
    expect(stageReducer(INITIAL_STAGE_STATE, { type: "LEAVE" })).toEqual(INITIAL_STAGE_STATE);
  });

  it("LEAVE_FAILED (stage:leave non envoyé) : erreur leave_failed visible jusqu'à DISMISS", () => {
    const failed = stageReducer({ phase: "stopping" }, { type: "LEAVE_FAILED" });
    expect(failed).toEqual({ phase: "error", reason: "leave_failed" });
    expect(stageReducer(failed, { type: "DISMISS" }).phase).toBe("idle");
  });

  it("stopping est une phase active (la session reste considérée ouverte)", () => {
    expect(isActive({ phase: "stopping" })).toBe(true);
  });
});
