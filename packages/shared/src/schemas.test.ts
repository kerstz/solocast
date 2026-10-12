import { describe, expect, it } from "vitest";
import {
  ChatMessageSchema,
  ChatTextSchema,
  PresenceUpdateSchema,
  SetPseudoRequestSchema,
  TokenResponseSchema,
} from "./schemas.js";
import { ClientWsMessageSchema } from "./events.js";

const validToken = {
  livekitUrl: "wss://live.example.test",
  token: "eyJhbGciOiJIUzI1NiJ9.placeholder.signature",
  identity: "user_123",
  canPublishVideo: false,
  canPublishAudio: true,
};

describe("TokenResponseSchema", () => {
  it("accepte une réponse de token valide", () => {
    expect(TokenResponseSchema.parse(validToken)).toEqual(validToken);
  });

  it("rejette un champ en trop et une URL non WebSocket", () => {
    expect(TokenResponseSchema.safeParse({ ...validToken, role: "streamer" }).success).toBe(false);
    expect(
      TokenResponseSchema.safeParse({ ...validToken, livekitUrl: "https://live.example.test" })
        .success,
    ).toBe(false);
  });

  it("accepte un chemin same-origin comme livekitUrl", () => {
    expect(TokenResponseSchema.safeParse({ ...validToken, livekitUrl: "/" }).success).toBe(true);
  });
});

describe("ChatMessageSchema", () => {
  const validMessage = {
    id: "msg_1",
    userId: "user_123",
    pseudo: "viewer_01",
    text: "Bonjour !",
    ts: 1_700_000_000_000,
    isStreamer: false,
  };

  it("accepte un message de chat valide", () => {
    expect(ChatMessageSchema.parse(validMessage)).toEqual(validMessage);
  });

  it("rejette un message vide", () => {
    expect(ChatMessageSchema.safeParse({ ...validMessage, text: "" }).success).toBe(false);
  });
});

describe("ClientWsMessageSchema", () => {
  it("accepte un chat:send valide et rejette un type inconnu", () => {
    expect(
      ClientWsMessageSchema.safeParse({ type: "chat:send", payload: { text: "salut" } }).success,
    ).toBe(true);
    expect(ClientWsMessageSchema.safeParse({ type: "admin:ban", payload: {} }).success).toBe(false);
  });
});

describe("Auth / studio schemas", () => {
  it("accepte une réponse /me viewer et rejette un champ en trop", async () => {
    const { MeResponseSchema } = await import("./schemas.js");
    const ok = { role: "viewer", viewerId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", pseudo: null };
    expect(MeResponseSchema.parse(ok)).toEqual(ok);
    expect(MeResponseSchema.safeParse({ ...ok, token: "x" }).success).toBe(false);
  });

  it("rejette un viewerId qui n'est pas un UUID v4", async () => {
    const { ViewerIdSchema } = await import("./schemas.js");
    expect(ViewerIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("contrats viewer / studio (ajouts front)", () => {
  it("accepte une couleur de la palette et rejette une couleur hors palette", () => {
    expect(SetPseudoRequestSchema.safeParse({ pseudo: "xX_Dark", color: "#c00000" }).success).toBe(
      true,
    );
    expect(SetPseudoRequestSchema.safeParse({ pseudo: "xX_Dark", color: "#ff8c00" }).success).toBe(
      false,
    );
  });

  it("rejette un champ mot de passe sur l'entrée viewer", () => {
    expect(
      SetPseudoRequestSchema.safeParse({ pseudo: "xX_Dark", password: "hunter2" }).success,
    ).toBe(false);
  });

  it("borne les speakers et exige le plafond de viewers", () => {
    expect(
      PresenceUpdateSchema.safeParse({
        count: 2,
        pseudos: ["a", "b"],
        live: true,
        speakers: 9,
        maxViewers: 50,
      }).success,
    ).toBe(false);
    expect(
      PresenceUpdateSchema.safeParse({ count: 2, pseudos: ["a", "b"], speakers: 1 }).success,
    ).toBe(false);
    // maxViewers manquant : la jauge « count/max » ne serait pas affichable.
    expect(
      PresenceUpdateSchema.safeParse({ count: 2, pseudos: ["a", "b"], live: false, speakers: 1 })
        .success,
    ).toBe(false);
    expect(
      PresenceUpdateSchema.safeParse({
        count: 2,
        pseudos: ["alice", "bobby"],
        live: false,
        speakers: 1,
        maxViewers: 0,
      }).success,
    ).toBe(false);
    expect(
      PresenceUpdateSchema.safeParse({
        count: 2,
        pseudos: ["alice", "bobby"],
        live: false,
        speakers: 1,
        maxViewers: 50,
      }).success,
    ).toBe(true);
  });

  it("texte de chat : brut uniquement, pas de HTML ni de contrôle", () => {
    expect(ChatTextSchema.safeParse("  salut le monde  ").success).toBe(true);
    expect(ChatTextSchema.safeParse("<b>gras</b>").success).toBe(false);
    expect(ChatTextSchema.safeParse("ligne\nune").success).toBe(false);
    expect(ChatTextSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});
