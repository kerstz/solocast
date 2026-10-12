import {
  CLIENT_EVENTS,
  ClientWsMessageSchema,
  ServerWsMessageSchema,
  WS_CLOSE_CODES,
  type ChatMessage,
  type PresenceUpdate,
} from "@solocast/shared";
import type { ChatTransport } from "./transport";

export type ChatConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type ChatEvent =
  | { kind: "status"; status: ChatConnectionStatus }
  | { kind: "history"; messages: ChatMessage[] }
  | { kind: "message"; message: ChatMessage }
  | { kind: "presence"; presence: PresenceUpdate }
  | { kind: "stageGranted" }
  | { kind: "stageRevoked" }
  | { kind: "stageRequest"; viewerId: string; pseudo: string }
  | { kind: "notice"; message: string }
  // Fermeture définitive (ban, flood, non authentifié) : plus aucune reconnexion.
  | { kind: "terminated"; reason: TerminalReason };

export type TerminalReason = "banned" | "flood" | "unauthorized" | "room_full";

/**
 * Fermetures définitives : le serveur a tranché, insister ne sert à rien.
 * BANNED (4003), FLOOD (4008) et ROOM_FULL (4009) viennent de @solocast/shared ; 4401 reste
 * accepté pour une fermeture « non authentifié » émise par un proxy.
 */
export const WS_CLOSE_UNAUTHORIZED = 4401;

const TERMINAL_CLOSE_REASONS: Readonly<Record<number, TerminalReason>> = {
  [WS_CLOSE_CODES.BANNED]: "banned",
  [WS_CLOSE_CODES.FLOOD]: "flood",
  [WS_CLOSE_CODES.ROOM_FULL]: "room_full",
  [WS_CLOSE_UNAUTHORIZED]: "unauthorized",
};

export interface ChatClientOptions {
  createTransport: () => ChatTransport;
  backoffInitialMs?: number;
  backoffMaxMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => {
    clearTimeout(id);
  };
};

/**
 * Client WebSocket chat. Valide tout message entrant et sortant (Zod @solocast/shared).
 * Reconnexion avec backoff exponentiel. Aucune autorité : le serveur décide tout.
 */
export class ChatClient {
  private transport: ChatTransport | null = null;
  private status: ChatConnectionStatus = "idle";
  private attempt = 0;
  private stopped = true;
  private cancelRetry: (() => void) | null = null;
  private readonly listeners = new Set<(event: ChatEvent) => void>();
  private readonly backoffInitialMs: number;
  private readonly backoffMaxMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly options: ChatClientOptions) {
    this.backoffInitialMs = options.backoffInitialMs ?? 500;
    this.backoffMaxMs = options.backoffMaxMs ?? 8000;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  getStatus(): ChatConnectionStatus {
    return this.status;
  }

  subscribe(listener: (event: ChatEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  close(): void {
    this.stopped = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    const current = this.transport;
    this.transport = null;
    current?.close();
    this.setStatus("idle");
  }

  /** Envoie un chat:send validé. Retourne false si non envoyé (hors ligne, texte invalide). */
  sendChat(text: string): boolean {
    const parsed = ClientWsMessageSchema.safeParse({
      type: CLIENT_EVENTS.CHAT_SEND,
      payload: { text },
    });
    return this.sendValidated(parsed);
  }

  /** Demande la parole (stage:request). Ce n'est qu'une demande : seul stage:granted ouvre l'antenne. */
  requestStage(): boolean {
    const parsed = ClientWsMessageSchema.safeParse({ type: CLIENT_EVENTS.STAGE_REQUEST });
    return this.sendValidated(parsed);
  }

  /** Quitte la scène (stage:leave). Le retrait réel est confirmé par stage:revoked, pas par ce retour. */
  leaveStage(): boolean {
    const parsed = ClientWsMessageSchema.safeParse({ type: CLIENT_EVENTS.STAGE_LEAVE });
    return this.sendValidated(parsed);
  }

  private sendValidated(parsed: ReturnType<typeof ClientWsMessageSchema.safeParse>): boolean {
    if (!parsed.success || this.transport === null || this.status !== "open") return false;
    this.transport.send(JSON.stringify(parsed.data));
    return true;
  }

  private open(): void {
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const transport = this.options.createTransport();
    this.transport = transport;

    transport.onOpen(() => {
      if (this.transport !== transport) return;
      this.attempt = 0;
      this.setStatus("open");
    });
    transport.onMessage((data) => {
      if (this.transport !== transport) return;
      this.handleRaw(data);
    });
    transport.onClose((code) => {
      if (this.transport !== transport) return;
      this.transport = null;
      if (this.stopped) return;
      const terminal = TERMINAL_CLOSE_REASONS[code];
      if (terminal !== undefined) {
        // Ban, flood ou session refusée : on arrête net au lieu de boucler en backoff.
        this.stopped = true;
        this.setStatus("closed");
        this.emit({ kind: "terminated", reason: terminal });
        return;
      }
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    const delay = Math.min(this.backoffMaxMs, this.backoffInitialMs * 2 ** this.attempt);
    this.attempt += 1;
    this.setStatus("reconnecting");
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private handleRaw(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ServerWsMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const msg = parsed.data;
    switch (msg.type) {
      case "chat:history":
        this.emit({ kind: "history", messages: msg.payload });
        break;
      case "chat:message":
        this.emit({ kind: "message", message: msg.payload });
        break;
      case "presence:update":
        this.emit({ kind: "presence", presence: msg.payload });
        break;
      case "stage:granted":
        this.emit({ kind: "stageGranted" });
        break;
      case "stage:revoked":
        this.emit({ kind: "stageRevoked" });
        break;
      case "stage:request":
        // Envoyé au seul streameur (le serveur ne le transmet jamais à un viewer).
        this.emit({
          kind: "stageRequest",
          viewerId: msg.payload.viewerId,
          pseudo: msg.payload.pseudo,
        });
        break;
      case "system:notice":
        this.emit({ kind: "notice", message: msg.payload.message });
        break;
    }
  }

  private setStatus(status: ChatConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ kind: "status", status });
  }

  private emit(event: ChatEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
