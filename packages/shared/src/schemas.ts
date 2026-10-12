import { z } from "zod";

// ---------------------------------------------------------------------------
// §5.1 Rôles
// ---------------------------------------------------------------------------

export const ROLES = ["streamer", "viewer"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const STAGE_PERMISSIONS = ["muted", "can_speak"] as const;
export const StagePermissionSchema = z.enum(STAGE_PERMISSIONS);
export type StagePermission = z.infer<typeof StagePermissionSchema>;

// ---------------------------------------------------------------------------
// Utilisateur & authentification
// ---------------------------------------------------------------------------

export const PSEUDO_MIN_LENGTH = 3;
export const PSEUDO_MAX_LENGTH = 24;

export const PseudoSchema = z
  .string()
  .min(PSEUDO_MIN_LENGTH)
  .max(PSEUDO_MAX_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, "Username accepts only letters, digits, '_' and '-'");

export const UserIdSchema = z.string().min(1).max(64);

// Palette de couleurs de pseudo, choisie par le viewer à l'entrée. Valeurs
// vérifiées en contraste AA (>= 4.5:1) sur fond blanc du chat.
export const VIEWER_COLORS = ["#c00000", "#007a1f", "#0000cc", "#8a008a", "#b35900"] as const;
export const ViewerColorSchema = z.enum(VIEWER_COLORS);
export type ViewerColor = z.infer<typeof ViewerColorSchema>;

// Identifiant viewer opaque, émis serveur (UUID v4). Il est la SEULE clé d'autorité côté viewer
// (grants de parole, bans). Le pseudo n'est jamais une clé d'autorité.
export const ViewerIdSchema = z.uuid({ version: "v4" });
export type ViewerId = z.infer<typeof ViewerIdSchema>;

// PUT /api/me/pseudo : pseudo choisi par le viewer. Validé ici, sans autorité.
export const SetPseudoRequestSchema = z.strictObject({
  pseudo: PseudoSchema,
  // Optionnel : couleur de pseudo choisie dans la palette VIEWER_COLORS (aucune autorité).
  color: ViewerColorSchema.optional(),
});
export type SetPseudoRequest = z.infer<typeof SetPseudoRequestSchema>;

// GET /api/me. Le rôle est décidé serveur (cookie streameur valide). Le JWT n'est jamais dans le corps.
export const MeResponseSchema = z.strictObject({
  role: RoleSchema,
  viewerId: ViewerIdSchema,
  pseudo: PseudoSchema.nullable(),
  color: ViewerColorSchema.nullable().optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// Corps d'erreur uniforme renvoyé par le backend (pas de valeur d'entrée réfléchie).
export const ErrorResponseSchema = z.strictObject({
  error: z.string().min(1).max(64),
  message: z.string().min(1).max(200),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// §5.2 Token LiveKit (réponse de POST /api/token)
// ---------------------------------------------------------------------------

export const TokenResponseSchema = z.strictObject({
  // ws(s)://hôte, ou un chemin same-origin (`/`) que le navigateur résout contre sa propre origine.
  livekitUrl: z
    .string()
    .regex(/^(wss?:\/\/|\/)\S*$/, "livekitUrl must start with ws://, wss:// or /"),
  token: z.string().min(1),
  identity: UserIdSchema,
  canPublishVideo: z.boolean(),
  canPublishAudio: z.boolean(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// §5.2bis Ingest OBS (réponse de POST /api/studio/ingest)
// url = serveur RTMP à coller dans OBS, streamKey = clé de flux (secret : streameur seulement).
export const IngestResponseSchema = z.strictObject({
  url: z.string().regex(/^rtmps?:\/\/\S+$/, "url must start with rtmp:// or rtmps://"),
  streamKey: z.string().min(1).max(512),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

// ---------------------------------------------------------------------------
// §5.3 Chat & routes admin de parole / modération
// ---------------------------------------------------------------------------

// §2.5 : streameur + 8 speakers WebRTC max (plafond anti-DoS egress), hors streameur.
export const MAX_SPEAKERS = 8;

export const CHAT_MESSAGE_MAX_LENGTH = 500;
export const CHAT_HISTORY_MAX_SIZE = 200;
// Flood : au-delà de ce nombre de rejets dans la fenêtre, la connexion WS est fermée.
export const CHAT_FLOOD_MAX_REJECTIONS = 20;
export const CHAT_FLOOD_WINDOW_MS = 10_000;

const HTML_TAG = /<\/?[A-Za-z!][^<>]*>/;

function hasControlCharacter(value: string): boolean {
  // Parcours par unité de code UTF-16 : les caractères de contrôle sont tous en ASCII.
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

// Texte de chat : texte brut uniquement (aucune balise HTML, aucun caractère de contrôle).
// Le rendu reste échappé côté front ; cette validation est la première barrière serveur.
export const ChatTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(CHAT_MESSAGE_MAX_LENGTH)
  .refine((value) => !hasControlCharacter(value), {
    message: "Message must not contain control characters",
  })
  .refine((value) => !HTML_TAG.test(value), {
    message: "Message must not contain HTML tags",
  });

export const ChatMessageSchema = z.strictObject({
  id: z.string().min(1).max(64),
  userId: UserIdSchema,
  pseudo: PseudoSchema,
  text: z.string().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
  ts: z.number().int().nonnegative(),
  isStreamer: z.boolean(),
  // Optionnel : absent pour les anciens messages / messages système.
  color: ViewerColorSchema.optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PresenceUpdateSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  pseudos: z.array(PseudoSchema),
  // true si le streameur a un WS actif ou un participant 'streamer' présent côté SFU.
  live: z.boolean(),
  // Nombre de clés stage:main:* actives (jauge « x/8 sur scène »).
  speakers: z.number().int().nonnegative().max(MAX_SPEAKERS),
  // Plafond de viewers simultanés du serveur (MAX_VIEWERS) : jauge « count/maxViewers ».
  maxViewers: z.number().int().positive(),
});
export type PresenceUpdate = z.infer<typeof PresenceUpdateSchema>;

export const SystemNoticeSchema = z.strictObject({
  message: z.string().min(1).max(200),
});
export type SystemNotice = z.infer<typeof SystemNoticeSchema>;

// POST /api/stage/grant | /api/stage/revoke : cible = viewerId (seule clé d'autorité viewer).
export const StageViewerRequestSchema = z.strictObject({
  viewerId: ViewerIdSchema,
});
export type StageViewerRequest = z.infer<typeof StageViewerRequestSchema>;

// Événement serveur -> streameur « stage:request » : demande de parole d'un viewer identifié par viewerId.
export const StageRequestPayloadSchema = z.strictObject({
  viewerId: ViewerIdSchema,
  pseudo: PseudoSchema,
});
export type StageRequestPayload = z.infer<typeof StageRequestPayloadSchema>;

export const BAN_TTL_MIN_SECONDS = 60;
export const BAN_TTL_MAX_SECONDS = 365 * 24 * 60 * 60;

// POST /api/moderation/ban : cible = viewerId. ttlSeconds absent = bannissement permanent.
export const BanRequestSchema = z.strictObject({
  viewerId: ViewerIdSchema,
  reason: z.string().trim().min(1).max(200).optional(),
  ttlSeconds: z.number().int().min(BAN_TTL_MIN_SECONDS).max(BAN_TTL_MAX_SECONDS).optional(),
});
export type BanRequest = z.infer<typeof BanRequestSchema>;

// ---------------------------------------------------------------------------
// §5.4 Room — V1 : une seule room fixe
// ---------------------------------------------------------------------------

export const ROOM_NAME = "main" as const;

// Identité LiveKit fixe du streameur : les viewers s'abonnent à ses pistes par cette identité.
export const STREAMER_IDENTITY = "streamer" as const;
export const RoomNameSchema = z.literal(ROOM_NAME);
export type RoomName = z.infer<typeof RoomNameSchema>;

// ---------------------------------------------------------------------------
// §5.4 Application installée (GET /api/app/status, POST /api/app/share, POST /api/app/quit)
// Réservé au streameur, depuis la machine qui fait tourner SoloCast.
// ---------------------------------------------------------------------------

export const ShareStateSchema = z.enum(["off", "starting", "on", "unavailable"]);
export type ShareState = z.infer<typeof ShareStateSchema>;

export const AppStatusSchema = z.strictObject({
  version: z.string().min(1).max(32),
  // `url` n'est renseignée que lorsque le partage est actif.
  share: z.strictObject({
    state: ShareStateSchema,
    url: z
      .string()
      .regex(/^https:\/\/\S+$/)
      .nullable(),
  }),
  // false : le serveur média (LiveKit) n'est pas livré avec cette installation.
  video: z.boolean(),
  // true : un service Ingress (OBS/RTMP) est disponible. Faux dans l'installation autonome.
  ingest: z.boolean(),
  // Ports à ouvrir sur la box pour que la vidéo atteigne des spectateurs distants.
  mediaPorts: z.strictObject({
    tcp: z.number().int().min(1).max(65_535),
    udp: z.number().int().min(1).max(65_535),
  }),
});
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const SetShareRequestSchema = z.strictObject({ enabled: z.boolean() });
export type SetShareRequest = z.infer<typeof SetShareRequestSchema>;
