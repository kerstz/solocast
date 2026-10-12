import { describe, expect, it } from "vitest";
import type { TokenResponse } from "@solocast/shared";
import {
  canRequest,
  INITIAL_STAGE_STATE,
  isOnAir,
  mutesStreamAudio,
  stageReducer,
  type StageEvent,
  type StageState,
} from "./stageMachine";

const token = (canPublishAudio: boolean): TokenResponse => ({
  livekitUrl: "wss://live.example.test",
  token: "signed-by-server",
  identity: "11111111-2222-4333-8444-555555555555",
  canPublishVideo: false,
  canPublishAudio,
});

function run(events: StageEvent[], from: StageState = INITIAL_STAGE_STATE): StageState {
  return events.reduce((state, event) => stageReducer(state, event), from);
}

describe("stageReducer : parcours nominal demander / parler / révoquer", () => {
  it("demande -> accordé -> token -> connexion -> micro -> antenne -> révoqué -> libre", () => {
    let s = INITIAL_STAGE_STATE;
    s = stageReducer(s, { type: "REQUEST" });
    expect(s.phase).toBe("requesting");
    s = stageReducer(s, { type: "GRANTED" });
    expect(s.phase).toBe("minting");
    s = stageReducer(s, { type: "TOKEN_OK", token: token(true) });
    expect(s.phase).toBe("connecting");
    s = stageReducer(s, { type: "CONNECTED" });
    expect(s.phase).toBe("publishing");
    s = stageReducer(s, { type: "MIC_ON" });
    expect(isOnAir(s)).toBe(true);
    expect(mutesStreamAudio(s)).toBe(true);
    s = stageReducer(s, { type: "REVOKED" });
    expect(s.phase).toBe("stopping");
    s = stageReducer(s, { type: "DISCONNECTED" });
    expect(s.phase).toBe("idle");
    expect(mutesStreamAudio(s)).toBe(false);
  });
});

describe("garde de sécurité : aucune publication sans grant serveur", () => {
  it("un token sans canPublishAudio ne mène jamais à la connexion", () => {
    const s = run([
      { type: "REQUEST" },
      { type: "GRANTED" },
      { type: "TOKEN_OK", token: token(false) },
    ]);
    expect(s).toEqual({ phase: "error", reason: "not_granted" });
    expect(isOnAir(s)).toBe(false);
  });

  it("TOKEN_OK sans passage par minting est ignoré", () => {
    const s = run([{ type: "TOKEN_OK", token: token(true) }]);
    expect(s.phase).toBe("idle");
  });

  it("le clic « demander » seul n'ouvre aucune antenne", () => {
    const s = run([{ type: "REQUEST" }]);
    expect(s.phase).toBe("requesting");
    expect(isOnAir(s)).toBe(false);
  });
});

describe("révocation et erreurs", () => {
  it("révoquer pendant une demande annule la demande", () => {
    expect(run([{ type: "REQUEST" }, { type: "REVOKED" }]).phase).toBe("idle");
  });

  it("révoquer pendant le mint revient à idle sans connexion", () => {
    expect(run([{ type: "REQUEST" }, { type: "GRANTED" }, { type: "REVOKED" }]).phase).toBe(
      "stopping",
    );
  });

  it("refus micro : erreur explicite, puis DISMISS revient à idle", () => {
    const failed = run([
      { type: "GRANTED" },
      { type: "TOKEN_OK", token: token(true) },
      { type: "CONNECTED" },
      { type: "MEDIA_FAILED", reason: "mic_denied" },
    ]);
    expect(failed).toEqual({ phase: "error", reason: "mic_denied" });
    expect(stageReducer(failed, { type: "DISMISS" }).phase).toBe("idle");
  });

  it("une déconnexion après erreur garde le message affiché", () => {
    const failed: StageState = { phase: "error", reason: "media_failed" };
    expect(stageReducer(failed, { type: "DISCONNECTED" })).toEqual(failed);
  });

  it("coupure inattendue en antenne ramène à idle", () => {
    const onAir: StageState = { phase: "on_air" };
    expect(stageReducer(onAir, { type: "DISCONNECTED" }).phase).toBe("idle");
  });

  it("échec du token : erreur token_failed", () => {
    expect(run([{ type: "GRANTED" }, { type: "TOKEN_FAILED" }]).phase).toBe("error");
  });

  it("request_failed (chat hors ligne) : erreur chat_unavailable", () => {
    expect(run([{ type: "REQUEST" }, { type: "REQUEST_FAILED" }])).toEqual({
      phase: "error",
      reason: "chat_unavailable",
    });
  });

  it("leave coupe l'antenne comme une révocation", () => {
    const onAir: StageState = { phase: "on_air" };
    expect(stageReducer(onAir, { type: "LEAVE" }).phase).toBe("stopping");
  });

  it("canRequest n'autorise que idle et error", () => {
    expect(canRequest({ phase: "idle" })).toBe(true);
    expect(canRequest({ phase: "error", reason: "mic_denied" })).toBe(true);
    expect(canRequest({ phase: "on_air" })).toBe(false);
    expect(canRequest({ phase: "requesting" })).toBe(false);
  });
});
