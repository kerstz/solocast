import { ServerWsMessageSchema, ViewerIdSchema, type ServerWsMessage } from "@solocast/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

// Bus de fan-out entre instances backend (Redis Pub/Sub en production, mémoire sinon).
// Chaque instance ne livre qu'aux sockets locales dont l'identité correspond à la cible.
export const CHAT_CHANNEL = "chat:main";

export type BusTarget = { to: "all" } | { to: "streamer" } | { to: "viewer"; viewerId: string };

export type BusEnvelope =
  | { kind: "event"; target: BusTarget; event: ServerWsMessage }
  | { kind: "close"; target: BusTarget; code: number; reason: string };

const TargetSchema = z.discriminatedUnion("to", [
  z.strictObject({ to: z.literal("all") }),
  z.strictObject({ to: z.literal("streamer") }),
  z.strictObject({ to: z.literal("viewer"), viewerId: ViewerIdSchema }),
]);

// Valide tout message reçu du bus : une instance ne fait pas confiance au canal.
export const BusEnvelopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("event"), target: TargetSchema, event: ServerWsMessageSchema }),
  z.strictObject({
    kind: z.literal("close"),
    target: TargetSchema,
    code: z.number().int().min(4000).max(4999),
    reason: z.string().max(120),
  }),
]);

export type BusHandler = (envelope: BusEnvelope) => void;
export type Unsubscribe = () => void;

export interface ChatBus {
  publish(envelope: BusEnvelope): Promise<void>;
  subscribe(handler: BusHandler): Unsubscribe;
}

export interface BusLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

// Implémentation mémoire : une seule instance de bus partagée par les « instances » de test.
export function createMemoryChatBus(): ChatBus {
  const handlers = new Set<BusHandler>();
  return {
    publish(envelope) {
      for (const handler of [...handlers]) {
        handler(envelope);
      }
      return Promise.resolve();
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

export interface RedisChatBusDeps {
  // Connexion de publication (partagée avec le reste de l'app).
  publisher: Redis;
  // Connexion dédiée aux abonnements (un client Redis en mode subscribe ne peut rien faire d'autre).
  subscriber: Redis;
  channel?: string;
  log: BusLogger;
}

export async function createRedisChatBus(deps: RedisChatBusDeps): Promise<ChatBus> {
  const channel = deps.channel ?? CHAT_CHANNEL;
  const handlers = new Set<BusHandler>();

  deps.subscriber.on("message", (receivedChannel: string, raw: string) => {
    if (receivedChannel !== channel) {
      return;
    }
    const parsed = parseEnvelope(raw);
    if (parsed === null) {
      // Ne journalise jamais le contenu du message (texte de chat, pseudo).
      deps.log.warn({ event: "chat.bus.invalid" }, "Message de bus invalide ignoré");
      return;
    }
    for (const handler of [...handlers]) {
      handler(parsed);
    }
  });
  await deps.subscriber.subscribe(channel);

  return {
    async publish(envelope) {
      await deps.publisher.publish(channel, JSON.stringify(envelope));
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}

function parseEnvelope(raw: string): BusEnvelope | null {
  try {
    const result = BusEnvelopeSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
