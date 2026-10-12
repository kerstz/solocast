import { z } from "zod";
import {
  CHAT_HISTORY_MAX_SIZE,
  ChatMessageSchema,
  ChatTextSchema,
  PresenceUpdateSchema,
  StageRequestPayloadSchema,
  SystemNoticeSchema,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// §5.3 Noms d'events WebSocket (chat). Constantes, pas de `enum` TypeScript.
// ---------------------------------------------------------------------------

export const CLIENT_EVENTS = {
  CHAT_SEND: "chat:send",
  STAGE_REQUEST: "stage:request",
  STAGE_LEAVE: "stage:leave",
} as const;

export const SERVER_EVENTS = {
  CHAT_MESSAGE: "chat:message",
  CHAT_HISTORY: "chat:history",
  PRESENCE_UPDATE: "presence:update",
  STAGE_GRANTED: "stage:granted",
  STAGE_REVOKED: "stage:revoked",
  STAGE_REQUEST: "stage:request",
  SYSTEM_NOTICE: "system:notice",
} as const;

// Chemin de la gateway WebSocket chat.
export const WS_PATH = "/ws" as const;

// Codes de fermeture WebSocket applicatifs (plage 4000-4999 réservée à l'application).
export const WS_CLOSE_CODES = {
  BANNED: 4003,
  FLOOD: 4008,
  // Salon plein : le plafond MAX_VIEWERS du serveur est atteint. Reconnecter n'y change rien.
  ROOM_FULL: 4009,
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

// ---------------------------------------------------------------------------
// Enveloppes WS validées par Zod (rejet strict : aucun champ en trop).
// Client -> Serveur
// ---------------------------------------------------------------------------

export const ClientChatSendSchema = z.strictObject({
  type: z.literal(CLIENT_EVENTS.CHAT_SEND),
  payload: z.strictObject({
    text: ChatTextSchema,
  }),
});

export const ClientStageRequestSchema = z.strictObject({
  type: z.literal(CLIENT_EVENTS.STAGE_REQUEST),
});

// Le viewer quitte la scène (son droit de parole est retiré côté serveur). Aucun payload.
export const ClientStageLeaveSchema = z.strictObject({
  type: z.literal(CLIENT_EVENTS.STAGE_LEAVE),
});

export const ClientWsMessageSchema = z.discriminatedUnion("type", [
  ClientChatSendSchema,
  ClientStageRequestSchema,
  ClientStageLeaveSchema,
]);
export type ClientWsMessage = z.infer<typeof ClientWsMessageSchema>;

// ---------------------------------------------------------------------------
// Serveur -> Client
// ---------------------------------------------------------------------------

export const ServerChatMessageSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.CHAT_MESSAGE),
  payload: ChatMessageSchema,
});

export const ServerChatHistorySchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.CHAT_HISTORY),
  payload: z.array(ChatMessageSchema).max(CHAT_HISTORY_MAX_SIZE),
});

export const ServerPresenceUpdateSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.PRESENCE_UPDATE),
  payload: PresenceUpdateSchema,
});

export const ServerStageGrantedSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.STAGE_GRANTED),
});

export const ServerStageRevokedSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.STAGE_REVOKED),
});

// Envoyé au seul streameur connecté (jamais à un viewer).
export const ServerStageRequestSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.STAGE_REQUEST),
  payload: StageRequestPayloadSchema,
});

export const ServerSystemNoticeSchema = z.strictObject({
  type: z.literal(SERVER_EVENTS.SYSTEM_NOTICE),
  payload: SystemNoticeSchema,
});

export const ServerWsMessageSchema = z.discriminatedUnion("type", [
  ServerChatMessageSchema,
  ServerChatHistorySchema,
  ServerPresenceUpdateSchema,
  ServerStageGrantedSchema,
  ServerStageRevokedSchema,
  ServerStageRequestSchema,
  ServerSystemNoticeSchema,
]);
export type ServerWsMessage = z.infer<typeof ServerWsMessageSchema>;
