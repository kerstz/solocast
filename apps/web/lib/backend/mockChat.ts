import {
  CHAT_MESSAGE_MAX_LENGTH,
  ClientWsMessageSchema,
  MAX_SPEAKERS,
  VIEWER_COLORS,
  type ChatMessage,
  type ViewerColor,
} from "@solocast/shared";
import type { ChatTransport } from "../chat/transport";

/** Données de démo : vivent dans le mock uniquement. */
const STREAMER = { userId: "solo-streamer", pseudo: "SoloMaster", color: VIEWER_COLORS[0] };
const MOCK_VIEWER_COUNT = 142;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 2000;
const STAGE_GRANT_DELAY_MS = 1500;
const STAGE_AUTO_REVOKE_MS = 20000;
const STAGE_LEAVE_ACK_MS = 150;
const AMBIENT_INTERVAL_MS = 7000;
/** Plafond de viewers affiché par le mock (le serveur réel renvoie MAX_VIEWERS). */
const MOCK_MAX_VIEWERS = 200;
/** Cadence des presence:update côté mock (le serveur réel pousse à chaque changement). */
export const MOCK_PRESENCE_INTERVAL_MS = 5000;
const STUDIO_REQUEST_DELAYS_MS = [1200, 8000] as const;

const AMBIENT_LINES: ReadonlyArray<{ pseudo: string; color: ViewerColor; text: string }> = [
  { pseudo: "citr0n", color: VIEWER_COLORS[3], text: "sound is crisp tonight" },
  { pseudo: "Ouf_Gamer92", color: VIEWER_COLORS[1], text: "anyone got the guestbook link?" },
  {
    pseudo: "bleu_de_france",
    color: VIEWER_COLORS[2],
    text: "can you open my mic? got a question",
  },
];

/** Viewers fictifs qui demandent la parole côté studio (viewerId = UUID v4 valide). */
export const MOCK_STAGE_REQUESTERS: ReadonlyArray<{ viewerId: string; pseudo: string }> = [
  { viewerId: "1f0e4c2a-3b5d-4e6f-8a7b-9c0d1e2f3a4b", pseudo: "bleu_de_france" },
  { viewerId: "7c9e6679-7425-40de-944b-e07fc1f90ae7", pseudo: "citr0n" },
];

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `mock-${String(idCounter)}`;
}

/** Grants de parole mock, partagés par toutes les sockets mock (un seul « serveur »). */
export const mockStageGrants = new Set<string>();

/** Diffusion mock en cours (pilotée par le broadcaster mock du studio). */
let mockLive = false;
const presenceListeners = new Set<() => void>();

function notifyPresence(): void {
  for (const listener of presenceListeners) listener();
}

export function mockGrantSpeaker(viewerId: string): void {
  mockStageGrants.add(viewerId);
  notifyPresence();
}

export function mockRevokeSpeaker(viewerId: string): void {
  mockStageGrants.delete(viewerId);
  notifyPresence();
}

export function setMockLive(live: boolean): void {
  mockLive = live;
  notifyPresence();
}

/** Seed affiché à la connexion (dates relatives à maintenant). */
export function buildSeed(now: number): ChatMessage[] {
  const msg = (
    minutesAgo: number,
    pseudo: string,
    userId: string,
    text: string,
    isStreamer: boolean,
    color: ViewerColor,
  ): ChatMessage => ({
    id: nextId(),
    userId,
    pseudo,
    text,
    ts: now - minutesAgo * 60_000,
    isStreamer,
    color,
  });
  return [
    msg(9, "Ouf_Gamer92", "viewer-a", "first!! yo everyone", false, VIEWER_COLORS[1]),
    msg(8, "citr0n", "viewer-b", "sound is crisp tonight", false, VIEWER_COLORS[3]),
    msg(
      7,
      STREAMER.pseudo,
      STREAMER.userId,
      "thanks for being here tonight folks",
      true,
      STREAMER.color,
    ),
    msg(
      6,
      "bleu_de_france",
      "viewer-c",
      "can you open my mic? got a question",
      false,
      VIEWER_COLORS[2],
    ),
    msg(
      1,
      STREAMER.pseudo,
      STREAMER.userId,
      "haha that is the point, pure year 2000 =)",
      true,
      STREAMER.color,
    ),
  ];
}

export type MockSocketRole = "viewer" | "streamer";

interface MockViewerIdentity {
  viewerId: string;
  pseudo: string | null;
  color: ViewerColor | null;
}

/**
 * Socket mock : simule le serveur (history, presence, rate-limit, grants, stage:leave).
 * Rôle viewer : chat + demande de parole. Rôle streamer : reçoit stage:request, pas de saisie.
 * Les textes sont rendus comme du texte par le front : aucun HTML n'est interprété.
 */
export class MockChatTransport implements ChatTransport {
  private openHandler: (() => void) | undefined;
  private messageHandler: ((data: string) => void) | undefined;
  private closeHandler: ((code: number) => void) | undefined;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private grantTimer: ReturnType<typeof setTimeout> | undefined;
  private revokeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly sent: number[] = [];
  private ambientIndex = 0;
  private closed = false;
  private readonly onPresence = (): void => {
    this.emitPresence();
  };

  constructor(
    private readonly viewer: MockViewerIdentity | null,
    private readonly role: MockSocketRole = "viewer",
  ) {
    presenceListeners.add(this.onPresence);
    this.later(() => {
      this.openHandler?.();
      this.emit({
        type: "chat:history",
        payload: buildSeed(Date.now()),
      });
      this.emitPresence();
      this.intervals.add(
        setInterval(() => {
          this.emitAmbient();
        }, AMBIENT_INTERVAL_MS),
      );
      this.intervals.add(
        setInterval(() => {
          this.emitPresence();
        }, MOCK_PRESENCE_INTERVAL_MS),
      );
      if (this.role === "streamer") this.scheduleStudioRequests();
    }, 60);
  }

  send(data: string): void {
    if (this.closed) return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ClientWsMessageSchema.safeParse(json);
    if (!parsed.success || this.role !== "viewer" || this.viewer === null) return;
    const msg = parsed.data;

    switch (msg.type) {
      case "chat:send":
        this.handleChat(msg.payload.text);
        return;
      case "stage:request":
        // stage:request n'est qu'une demande : le mock accorde après un délai (simule le streameur).
        this.clearTimer("grant");
        this.grantTimer = this.later(() => {
          const viewer = this.viewer;
          if (viewer === null) return;
          mockGrantSpeaker(viewer.viewerId);
          this.emit({ type: "stage:granted" });
          this.clearTimer("revoke");
          this.revokeTimer = this.later(() => {
            mockRevokeSpeaker(viewer.viewerId);
            this.emit({ type: "stage:revoked" });
          }, STAGE_AUTO_REVOKE_MS);
        }, STAGE_GRANT_DELAY_MS);
        return;
      case "stage:leave":
        // Le serveur confirme le retrait par stage:revoked (le front attend cette confirmation).
        this.clearTimer("grant");
        this.clearTimer("revoke");
        this.later(() => {
          if (this.viewer !== null) mockRevokeSpeaker(this.viewer.viewerId);
          this.emit({ type: "stage:revoked" });
        }, STAGE_LEAVE_ACK_MS);
        return;
    }
  }

  close(): void {
    this.closed = true;
    presenceListeners.delete(this.onPresence);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const i of this.intervals) clearInterval(i);
    this.intervals.clear();
    this.closeHandler?.(1000);
  }

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }
  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }
  onClose(handler: (code: number) => void): void {
    this.closeHandler = handler;
  }

  private handleChat(text: string): void {
    const viewer = this.viewer;
    if (viewer === null) return;
    const now = Date.now();
    while (this.sent.length > 0 && now - (this.sent[0] ?? 0) > RATE_LIMIT_WINDOW_MS) {
      this.sent.shift();
    }
    if (this.sent.length >= RATE_LIMIT_MAX) {
      this.emit({
        type: "system:notice",
        payload: {
          message: `Doucement : ${String(RATE_LIMIT_MAX)} messages maximum toutes les 2 secondes.`,
        },
      });
      return;
    }
    this.sent.push(now);
    this.emit({
      type: "chat:message",
      payload: {
        id: nextId(),
        userId: viewer.viewerId,
        pseudo: viewer.pseudo ?? "viewer",
        text: text.slice(0, CHAT_MESSAGE_MAX_LENGTH),
        ts: now,
        isStreamer: false,
        color: viewer.color ?? VIEWER_COLORS[2],
      },
    });
  }

  private scheduleStudioRequests(): void {
    STUDIO_REQUEST_DELAYS_MS.forEach((delay, index) => {
      const requester = MOCK_STAGE_REQUESTERS[index];
      if (!requester) return;
      this.later(() => {
        this.emit({ type: "stage:request", payload: requester });
      }, delay);
    });
  }

  private emitAmbient(): void {
    const line = AMBIENT_LINES[this.ambientIndex % AMBIENT_LINES.length];
    this.ambientIndex += 1;
    if (!line) return;
    this.emit({
      type: "chat:message",
      payload: {
        id: nextId(),
        userId: `ambient-${line.pseudo}`,
        pseudo: line.pseudo,
        text: line.text,
        ts: Date.now(),
        isStreamer: false,
        color: line.color,
      },
    });
  }

  private emitPresence(): void {
    if (this.closed) return;
    this.emit({
      type: "presence:update",
      payload: {
        count: MOCK_VIEWER_COUNT,
        pseudos: [STREAMER.pseudo, ...AMBIENT_LINES.map((l) => l.pseudo)],
        live: mockLive,
        speakers: Math.min(mockStageGrants.size, MAX_SPEAKERS),
        maxViewers: MOCK_MAX_VIEWERS,
      },
    });
  }

  private emit(envelope: unknown): void {
    this.messageHandler?.(JSON.stringify(envelope));
  }

  private clearTimer(kind: "grant" | "revoke"): void {
    const timer = kind === "grant" ? this.grantTimer : this.revokeTimer;
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(timer);
    }
    if (kind === "grant") this.grantTimer = undefined;
    else this.revokeTimer = undefined;
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, ms);
    this.timers.add(t);
    return t;
  }
}
