import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Writable } from "node:stream";
import { WebhookReceiver } from "livekit-server-sdk";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createStreamerAuth } from "./auth/streamer-auth.js";
import { createTokenCodec } from "./auth/tokens.js";
import { createViewerIdentity, VIEWER_SESSION_TTL_SECONDS } from "./auth/viewer-identity.js";
import { createChatHub } from "./chat/hub.js";
import { createMemoryChatServices, type ChatServices } from "./chat/services.js";
import type { AppConfig } from "./config.js";
import { registerErrorHandlers } from "./http/errors.js";
import { createLiveKitGateway, type LiveKitGateway } from "./livekit/gateway.js";
import { createViewerCapacity } from "./room/viewer-capacity.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerModerationRoutes } from "./routes/moderation.js";
import { registerStageRoutes } from "./routes/stage.js";
import { registerStudioRoutes } from "./routes/studio.js";
import { registerTokenRoutes } from "./routes/token.js";
import type { KeyValueStore } from "./state/key-value-store.js";
import type { StageNotifier } from "./stage/stage-notifier.js";
import { createSpeakerRevoker } from "./stage/revoke-speaker.js";
import { createStageRegistry } from "./stage/stage-registry.js";
import { registerChatGateway } from "./ws/gateway.js";
import { registerLiveKitWebhookRoutes, type LiveKitWebhookVerifier } from "./webhooks/livekit.js";

export interface BuildAppOptions {
  config: AppConfig;
  store: KeyValueStore;
  // Store du rate-limit : Redis en production, mémoire (défaut plugin) si absent (tests).
  redis?: Redis;
  // Sortie des logs. Par défaut stdout (pino). Utilisé par les tests pour vérifier l'absence de secrets.
  logStream?: Writable;
  // Passerelle SFU. Défaut : client livekit-server-sdk construit depuis config (tests : fake).
  livekit?: LiveKitGateway;
  // Port d'événements stage vers les clients. Défaut : hub WebSocket (WP3).
  stageNotifier?: StageNotifier;
  // Bus, état et rate-limit chat. Défaut : mémoire (une seule instance). Redis en production.
  chat?: ChatServices;
  // Vérification des webhooks LiveKit. Défaut : WebhookReceiver (clé/secret LiveKit). Tests : fake.
  livekitWebhookVerifier?: LiveKitWebhookVerifier;
  // Coalescence des diffusions de présence (ms). 0 = immédiat (tests).
  presenceCoalesceMs?: number;
}

// Chemins censurés dans les logs : aucun cookie, jeton, clé ou mot de passe ne doit sortir.
const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "key",
  "*.key",
  "token",
  "*.token",
  "password",
  "*.password",
];

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, store } = options;
  const loggerBase = {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  };
  const app = Fastify({
    logger:
      options.logStream === undefined ? loggerBase : { ...loggerBase, stream: options.logStream },
    bodyLimit: 4_096,
    // Derrière Caddy (WP6) : sans ça, le rate-limit voit l'IP du proxy pour toutes les requêtes.
    trustProxy: config.TRUST_PROXY,
  });

  const codec = createTokenCodec(config.JWT_SECRET);
  const streamerAuth = createStreamerAuth({ codec, store });
  const viewers = createViewerIdentity({ codec, store });
  const livekit =
    options.livekit ??
    createLiveKitGateway({
      serverUrl: config.LIVEKIT_URL,
      apiKey: config.LIVEKIT_API_KEY,
      apiSecret: config.LIVEKIT_API_SECRET,
      roomName: config.ROOM_NAME,
      tokenTtlSeconds: config.LIVEKIT_TOKEN_TTL_SECONDS,
    });
  // Plafond de viewers simultanés. Partagé par la passerelle WS et /api/token : une place par
  // viewerId, donc plusieurs onglets d'une même personne ne consomment qu'une place.
  const capacity = createViewerCapacity({ store, max: config.MAX_VIEWERS });
  const stage = createStageRegistry({
    store,
    roomName: config.ROOM_NAME,
    maxSpeakers: config.MAX_SPEAKERS,
    ttlSeconds: VIEWER_SESSION_TTL_SECONDS,
  });
  const authMiddleware = createAuthMiddleware({
    streamerAuth,
    viewers,
    streamerCookieName: config.SESSION_COOKIE_NAME,
    viewerCookieName: config.VIEWER_COOKIE_NAME,
  });

  const chat = options.chat ?? createMemoryChatServices({ historySize: config.CHAT_HISTORY_SIZE });
  // Retrait de parole partagé par la route /api/stage/revoke et par stage:leave (WS).
  // La notification passe par le hub : référence différée (évaluée à l'appel), sans cycle.
  const revokeSpeaker = createSpeakerRevoker({
    stage,
    livekit,
    // Même port de notification que les routes (hub WebSocket en production, fake en test).
    notify: (notification) => (options.stageNotifier ?? hub).notify(notification),
    log: app.log,
  });
  const hub = createChatHub({
    bus: chat.bus,
    state: chat.state,
    limiter: chat.limiter,
    log: app.log,
    viewerSlots: capacity,
    maxViewers: capacity.max,
    renewStudioLease: (tokenId) => streamerAuth.renewLease(tokenId),
    countSpeakers: () => stage.count(),
    isSpeaker: (viewerId) => stage.isSpeaker(viewerId),
    ...(options.presenceCoalesceMs === undefined
      ? {}
      : { presenceCoalesceMs: options.presenceCoalesceMs }),
    leaveStage: revokeSpeaker,
    chatRateLimit: { max: config.CHAT_RATE_LIMIT_MAX, windowMs: config.CHAT_RATE_LIMIT_WINDOW_MS },
  });

  await app.register(cookie);
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: [config.CORS_ORIGIN],
    credentials: true,
    methods: ["GET", "PUT", "POST"],
  });
  await app.register(rateLimit, {
    global: false,
    ...(options.redis === undefined ? {} : { redis: options.redis }),
  });

  app.decorateRequest("viewer", undefined);
  app.decorate("authMiddleware", authMiddleware);
  registerErrorHandlers(app);

  const routeDeps = {
    streamerAuth,
    viewers,
    authMiddleware,
    cookies: {
      secure: config.COOKIE_SECURE,
      streamerName: config.SESSION_COOKIE_NAME,
      viewerName: config.VIEWER_COOKIE_NAME,
    },
    studioRateLimit: {
      max: config.STUDIO_RATE_LIMIT_MAX,
      timeWindow: config.STUDIO_RATE_LIMIT_WINDOW_MS,
    },
    tokenRateLimit: {
      max: config.TOKEN_RATE_LIMIT_MAX,
      timeWindow: config.TOKEN_RATE_LIMIT_WINDOW_MS,
    },
    livekit,
    livekitPublicWsUrl: config.LIVEKIT_PUBLIC_WS_URL,
    stage,
    capacity,
    revokeSpeaker,
    stageNotifier: options.stageNotifier ?? hub,
    store,
    hub,
  };
  // Liveness probe used by start.sh (and any reverse proxy). No session, no store access.
  app.get("/health", async (_request, reply) => reply.send({ status: "ok" }));

  registerStudioRoutes(app, routeDeps);
  registerMeRoutes(app, routeDeps);
  registerTokenRoutes(app, routeDeps);
  registerStageRoutes(app, routeDeps);
  registerModerationRoutes(app, routeDeps);

  await registerChatGateway(app, {
    hub,
    viewers,
    streamerAuth,
    capacity,
    store,
    cookies: { streamerName: config.SESSION_COOKIE_NAME, viewerName: config.VIEWER_COOKIE_NAME },
    allowedOrigin: config.CORS_ORIGIN,
    maxPayloadBytes: CHAT_WS_MAX_PAYLOAD_BYTES,
  });
  registerLiveKitWebhookRoutes(app, {
    verifier:
      options.livekitWebhookVerifier ??
      new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET),
    hub,
    log: app.log,
  });

  app.addHook("onReady", (done) => {
    hub.start();
    done();
  });
  app.addHook("onClose", (_instance, done) => {
    hub.stop();
    done();
  });

  return app;
}

// Une trame chat : texte max 500 caractères (jusqu'à 4 octets UTF-8) + enveloppe JSON.
const CHAT_WS_MAX_PAYLOAD_BYTES = 4_096;
