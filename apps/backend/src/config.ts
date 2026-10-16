import { CHAT_HISTORY_MAX_SIZE, MAX_SPEAKERS, RoomNameSchema } from "@solocast/shared";
import { z } from "zod";

// Toute la configuration backend passe par ce module. Aucun secret n'a de défaut.
// Les messages d'erreur citent le nom de la variable, jamais sa valeur.

const JWT_SECRET_MIN_BYTES = 32;
const PLACEHOLDER_PREFIX = "CHANGE_ME";

const RedisUrlSchema = z.url({ protocol: /^rediss?$/ });

const SecretSchema = (name: string, minBytes: number) =>
  z
    .string()
    .refine((value) => Buffer.byteLength(value, "utf8") >= minBytes, {
      message: `${name} must be at least ${String(minBytes)} bytes long`,
    })
    .refine((value) => !value.startsWith(PLACEHOLDER_PREFIX), {
      message: `${name} still holds the placeholder value from .env.example`,
    });

// Origines (schéma://hôte[:port]) de l'allowlist CORS, séparées par des virgules. Jamais '*',
// jamais de chemin : l'app peut être jointe par localhost, 127.0.0.1 et l'adresse du tunnel.
const BareOriginSchema = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "";
      } catch {
        return false;
      }
    },
    { message: "CORS_ORIGIN must be bare origins (scheme://host[:port]), with no path" },
  )
  .transform((value) => new URL(value).origin);

const CorsOriginSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  )
  .pipe(z.array(BareOriginSchema).min(1));

const CookieNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const STUDIO_KEY_MIN_BYTES = 32;
const DAY_SECONDS = 24 * 60 * 60;

// Adresse d'écoute réservée à cette machine. Tout le reste (0.0.0.0, IP LAN, nom DNS) expose le
// backend au réseau : le studio doit alors être protégé par une clé.
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

const LIVEKIT_API_SECRET_MIN_BYTES = 32;
const LIVEKIT_TOKEN_TTL_MIN_SECONDS = 60;
const LIVEKIT_TOKEN_TTL_MAX_SECONDS = 3_600;
const LIVEKIT_TOKEN_TTL_DEFAULT_SECONDS = 600;

const AppEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
    BACKEND_HOST: z.string().min(1),
    BACKEND_PORT: z.coerce.number().int().min(1).max(65_535),
    // Where ephemeral state lives. `memory` = single process, no Redis (local run, the default).
    // `redis` = shared state, required as soon as more than one backend instance runs.
    STATE_BACKEND: z.enum(["memory", "redis"]).default("memory"),
    REDIS_URL: RedisUrlSchema.optional(),
    // Signe les JWT de session (streameur et viewer). HS256, >= 32 octets.
    JWT_SECRET: SecretSchema("JWT_SECRET", JWT_SECRET_MIN_BYTES),
    CORS_ORIGIN: CorsOriginSchema,
    COOKIE_SECURE: z.stringbool(),
    // true derrière un reverse-proxy (Caddy) : sans ça, le rate-limit compte l'IP du proxy pour tous.
    TRUST_PROXY: z.stringbool().default(false),
    SESSION_COOKIE_NAME: CookieNameSchema,
    VIEWER_COOKIE_NAME: CookieNameSchema,
    // Accès au studio. `key` (défaut) : POST /api/studio/open exige STUDIO_KEY. `local` : le
    // studio ne s'ouvre que depuis cette machine (adresse de connexion ET Host loopback) ; refusé
    // au démarrage si le backend écoute ailleurs que sur loopback ou derrière un reverse-proxy.
    STUDIO_ACCESS: z.enum(["key", "local"]).default("key"),
    // Clé d'entrée du studio en mode `key` (>= 32 octets aléatoires : openssl rand -hex 32).
    STUDIO_KEY: SecretSchema("STUDIO_KEY", STUDIO_KEY_MIN_BYTES).optional(),
    // Plafonne POST /api/studio/open (anti-force brute de la clé, anti-prise de place en boucle).
    STUDIO_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    STUDIO_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    // API serveur LiveKit (RoomService : updateParticipant). Backend -> SFU uniquement.
    LIVEKIT_URL: z.url({ protocol: /^https?$/ }),
    // URL WebSocket renvoyée au navigateur dans TokenResponse.livekitUrl.
    // Un chemin (`/`) vaut « même origine que la page » : le navigateur le résout lui-même.
    LIVEKIT_PUBLIC_WS_URL: z.union([
      z.url({ protocol: /^wss?$/ }),
      z.string().regex(/^\/\S*$/, "LIVEKIT_PUBLIC_WS_URL must be ws(s)://… or a path"),
    ]),
    LIVEKIT_API_KEY: SecretSchema("LIVEKIT_API_KEY", 1),
    LIVEKIT_API_SECRET: SecretSchema("LIVEKIT_API_SECRET", LIVEKIT_API_SECRET_MIN_BYTES),
    // Durée de vie du token LiveKit (WP7 : TTL court).
    LIVEKIT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(LIVEKIT_TOKEN_TTL_MIN_SECONDS)
      .max(LIVEKIT_TOKEN_TTL_MAX_SECONDS)
      .default(LIVEKIT_TOKEN_TTL_DEFAULT_SECONDS),
    // Room fixe V1 : doit valoir "main" (RoomNameSchema de @solocast/shared).
    ROOM_NAME: RoomNameSchema,
    // Viewers simultanés acceptés dans le salon (chat + token LiveKit). Au-delà, le serveur
    // referme la socket avec WS_CLOSE_CODES.ROOM_FULL et /api/token répond 503.
    MAX_VIEWERS: z.coerce.number().int().min(1).default(50),
    // Speakers WebRTC simultanés hors streameur (§2.5). Plafond dur = MAX_SPEAKERS du contrat
    // partagé : au-delà, la jauge « x/8 » de presence:update ne serait plus représentable.
    MAX_SPEAKERS: z.coerce.number().int().min(0).max(MAX_SPEAKERS).default(MAX_SPEAKERS),
    // Anti-abus de POST /api/token (une session SFU coûte de l'egress : cf. §2.5).
    TOKEN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    TOKEN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    // Chat WS (WP3) : taille de l'historique Redis et rate-limit par viewerId.
    CHAT_HISTORY_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(CHAT_HISTORY_MAX_SIZE)
      .default(CHAT_HISTORY_MAX_SIZE),
    // Connexions WebSocket simultanées par adresse IP (le streameur n'est pas compté).
    WS_MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(100).default(3),
    // Intervalle du heartbeat WebSocket : une socket qui ne répond pas au ping suivant est coupée
    // et sa place libérée.
    WS_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    // Durée du bannissement de l'empreinte IP (HMAC, jamais l'IP en clair) qui double le ban par
    // identité : effacer son cookie ne suffit plus. Bornée : une IP est partagée (CGNAT, Wi-Fi).
    BAN_IP_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(7 * DAY_SECONDS)
      .default(DAY_SECONDS),
    CHAT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3),
    CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(100).default(2_000),
  })
  .superRefine((env, ctx) => {
    if (env.STATE_BACKEND === "redis" && env.REDIS_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["REDIS_URL"],
        message: "REDIS_URL is required when STATE_BACKEND=redis",
      });
    }
    if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "COOKIE_SECURE must be true when NODE_ENV=production",
      });
    }
    if (env.STUDIO_ACCESS === "key" && env.STUDIO_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["STUDIO_KEY"],
        message:
          "STUDIO_KEY is required when STUDIO_ACCESS=key (or set STUDIO_ACCESS=local on a loopback-only backend)",
      });
    }
    if (env.STUDIO_ACCESS === "local" && !isLoopbackHost(env.BACKEND_HOST)) {
      ctx.addIssue({
        code: "custom",
        path: ["STUDIO_ACCESS"],
        message:
          "STUDIO_ACCESS=local requires a loopback BACKEND_HOST; set STUDIO_ACCESS=key and STUDIO_KEY to listen on the network",
      });
    }
    if (env.STUDIO_ACCESS === "local" && env.TRUST_PROXY) {
      ctx.addIssue({
        code: "custom",
        path: ["STUDIO_ACCESS"],
        message:
          "STUDIO_ACCESS=local cannot be used behind a reverse proxy (TRUST_PROXY=true); use STUDIO_ACCESS=key",
      });
    }
    if (env.SESSION_COOKIE_NAME === env.VIEWER_COOKIE_NAME) {
      ctx.addIssue({
        code: "custom",
        path: ["VIEWER_COOKIE_NAME"],
        message: "VIEWER_COOKIE_NAME must differ from SESSION_COOKIE_NAME",
      });
    }
  });

export type AppConfig = z.infer<typeof AppEnvSchema>;

export class ConfigError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    super(
      `Invalid configuration: ${issues
        .map((issue) => `${issue.path.join(".") || "env"} (${issue.message})`)
        .join("; ")}`,
    );
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = AppEnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  return result.data;
}
