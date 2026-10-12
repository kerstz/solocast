import { describe, expect, it } from "vitest";
import type { ChatTransport } from "./transport";
import { ChatClient, type ChatEvent } from "./chatClient";

class FakeTransport implements ChatTransport {
  sent: string[] = [];
  openH?: () => void;
  messageH?: (d: string) => void;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    /* fermé par le test */
  }
  onOpen(h: () => void): void {
    this.openH = h;
  }
  onMessage(h: (d: string) => void): void {
    this.messageH = h;
  }
  onClose(): void {
    /* non utilisé */
  }
}

function setup(): {
  client: ChatClient;
  transport: () => FakeTransport | undefined;
  events: ChatEvent[];
} {
  const transports: FakeTransport[] = [];
  const events: ChatEvent[] = [];
  const client = new ChatClient({
    createTransport: () => {
      const t = new FakeTransport();
      transports.push(t);
      return t;
    },
  });
  client.subscribe((e) => events.push(e));
  return { client, transport: () => transports[0], events };
}

describe("ChatClient : sortie de scène (stage:leave)", () => {
  it("envoie stage:leave seulement socket ouverte, sans payload", () => {
    const h = setup();
    expect(h.client.leaveStage()).toBe(false);
    h.client.connect();
    h.transport()?.openH?.();
    expect(h.client.leaveStage()).toBe(true);
    expect(JSON.parse(h.transport()?.sent[0] ?? "null")).toEqual({ type: "stage:leave" });
  });
});

describe("ChatClient : demandes reçues par le streameur (stage:request)", () => {
  it("transmet la demande validée sous forme stageRequest", () => {
    const h = setup();
    h.client.connect();
    const t = h.transport();
    t?.openH?.();
    t?.messageH?.(
      JSON.stringify({
        type: "stage:request",
        payload: { viewerId: "1f0e4c2a-3b5d-4e6f-8a7b-9c0d1e2f3a4b", pseudo: "bleu_de_france" },
      }),
    );
    expect(h.events).toContainEqual({
      kind: "stageRequest",
      viewerId: "1f0e4c2a-3b5d-4e6f-8a7b-9c0d1e2f3a4b",
      pseudo: "bleu_de_france",
    });
  });

  it("rejette une demande au viewerId non UUID v4", () => {
    const h = setup();
    h.client.connect();
    const t = h.transport();
    t?.openH?.();
    t?.messageH?.(
      JSON.stringify({ type: "stage:request", payload: { viewerId: "x", pseudo: "bleu" } }),
    );
    expect(h.events.some((e) => e.kind === "stageRequest")).toBe(false);
  });
});
