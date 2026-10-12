import { describe, expect, it } from "vitest";
import { WS_CLOSE_CODES } from "@solocast/shared";
import type { ChatTransport } from "./transport";
import { ChatClient, type ChatEvent, WS_CLOSE_UNAUTHORIZED } from "./chatClient";

/** Transport factice pilotable depuis le test. */
class FakeTransport implements ChatTransport {
  sent: string[] = [];
  closed = false;
  openH?: () => void;
  messageH?: (d: string) => void;
  closeH?: (code: number) => void;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  onOpen(h: () => void): void {
    this.openH = h;
  }
  onMessage(h: (d: string) => void): void {
    this.messageH = h;
  }
  onClose(h: (code: number) => void): void {
    this.closeH = h;
  }
}

interface Harness {
  client: ChatClient;
  transports: FakeTransport[];
  events: ChatEvent[];
  timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
}

function setup(): Harness {
  const transports: FakeTransport[] = [];
  const events: ChatEvent[] = [];
  const timers: Harness["timers"] = [];
  const client = new ChatClient({
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
    backoffInitialMs: 100,
    backoffMaxMs: 400,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  client.subscribe((e) => events.push(e));
  return { client, transports, events, timers };
}

const message = {
  id: "m1",
  userId: "u1",
  pseudo: "citr0n",
  text: "salut",
  ts: 1_700_000_000_000,
  isStreamer: false,
};

describe("ChatClient", () => {
  it("passe en open, reçoit l'historique puis les messages live", () => {
    const h = setup();
    h.client.connect();
    const t = h.transports[0];
    t?.openH?.();
    expect(h.client.getStatus()).toBe("open");

    t?.messageH?.(JSON.stringify({ type: "chat:history", payload: [message] }));
    t?.messageH?.(JSON.stringify({ type: "chat:message", payload: { ...message, id: "m2" } }));

    expect(h.events.filter((e) => e.kind === "history")).toHaveLength(1);
    expect(h.events.filter((e) => e.kind === "message")).toHaveLength(1);
  });

  it("ignore les messages invalides (JSON cassé, champ en trop, type inconnu)", () => {
    const h = setup();
    h.client.connect();
    const t = h.transports[0];
    t?.openH?.();
    t?.messageH?.("{pas du json");
    t?.messageH?.(JSON.stringify({ type: "chat:message", payload: { ...message, role: "admin" } }));
    t?.messageH?.(JSON.stringify({ type: "admin:ban", payload: {} }));
    expect(h.events.some((e) => e.kind === "message" || e.kind === "history")).toBe(false);
  });

  it("envoie chat:send validé et refuse un texte vide ou hors ligne", () => {
    const h = setup();
    expect(h.client.sendChat("hors ligne")).toBe(false);
    h.client.connect();
    const t = h.transports[0];
    expect(h.client.sendChat("   ")).toBe(false);
    t?.openH?.();
    expect(h.client.sendChat("  bonjour  ")).toBe(true);
    expect(JSON.parse(t?.sent[0] ?? "null")).toEqual({
      type: "chat:send",
      payload: { text: "bonjour" },
    });
  });

  it("stage:request n'est qu'une demande, émise seulement socket ouverte", () => {
    const h = setup();
    expect(h.client.requestStage()).toBe(false);
    h.client.connect();
    h.transports[0]?.openH?.();
    expect(h.client.requestStage()).toBe(true);
    expect(JSON.parse(h.transports[0]?.sent[0] ?? "null")).toEqual({ type: "stage:request" });
  });

  it("reconnecte avec backoff exponentiel plafonné", () => {
    const h = setup();
    h.client.connect();
    h.transports[0]?.openH?.();
    h.transports[0]?.closeH?.(1006);
    expect(h.client.getStatus()).toBe("reconnecting");
    expect(h.timers[0]?.ms).toBe(100);

    h.timers[0]?.fn();
    h.transports[1]?.closeH?.(1006);
    expect(h.timers[1]?.ms).toBe(200);

    h.timers[1]?.fn();
    h.transports[2]?.closeH?.(1006);
    expect(h.timers[2]?.ms).toBe(400);
    h.timers[2]?.fn();
    h.transports[3]?.closeH?.(1006);
    expect(h.timers[3]?.ms).toBe(400);
  });

  it("n'insiste pas sur une fermeture non authentifiée", () => {
    const h = setup();
    h.client.connect();
    h.transports[0]?.openH?.();
    h.transports[0]?.closeH?.(WS_CLOSE_UNAUTHORIZED);
    expect(h.client.getStatus()).toBe("closed");
    expect(h.timers).toHaveLength(0);
  });

  it("salon plein (ROOM_FULL) : fermeture définitive, aucune reconnexion", () => {
    const h = setup();
    h.client.connect();
    h.transports[0]?.openH?.();
    h.transports[0]?.closeH?.(WS_CLOSE_CODES.ROOM_FULL);
    expect(h.client.getStatus()).toBe("closed");
    expect(h.timers).toHaveLength(0);
    expect(h.events.at(-1)).toEqual({ kind: "terminated", reason: "room_full" });
  });

  it("close() coupe la socket, annule la reconnexion et ignore les événements tardifs", () => {
    const h = setup();
    h.client.connect();
    h.transports[0]?.openH?.();
    h.transports[0]?.closeH?.(1006);
    h.client.close();
    expect(h.timers[0]?.cancelled).toBe(true);
    expect(h.client.getStatus()).toBe("idle");
    const before = h.events.length;
    h.transports[0]?.messageH?.(JSON.stringify({ type: "chat:history", payload: [] }));
    expect(h.events.length).toBe(before);
  });

  it("transmet system:notice et stage:granted / stage:revoked", () => {
    const h = setup();
    h.client.connect();
    const t = h.transports[0];
    t?.openH?.();
    t?.messageH?.(JSON.stringify({ type: "system:notice", payload: { message: "Doucement" } }));
    t?.messageH?.(JSON.stringify({ type: "stage:granted" }));
    t?.messageH?.(JSON.stringify({ type: "stage:revoked" }));
    expect(h.events).toContainEqual({ kind: "notice", message: "Doucement" });
    expect(h.events).toContainEqual({ kind: "stageGranted" });
    expect(h.events).toContainEqual({ kind: "stageRevoked" });
  });
});
