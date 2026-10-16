import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Writable } from "node:stream";
import { WebhookReceiver } from "livekit-server-sdk";
import { createAuthMiddleware } from "./auth/middleware.js";
import { createStreamerAuth } from "./auth/streamer-auth.js";
import { createStudioKeyVerifier } from "./auth/studio-key.js";
import { createTokenCodec } from "./auth/tokens.js";
import { createViewerIdentity, VIEWER_SESSION_TTL_SECONDS } from "./auth/viewer-identity.js";
import { createChatHub } from "./chat/hub.js";
import { createMemoryChatServices, type ChatServices } from "./chat/services.js";
import type { AppConfig } from "./config.js";
import { HttpError, registerErrorHandlers } from "./http/errors.js";
import { isLocalHost, isLocalRequest, isLoopbackAddress } from "./http/local-host.js";
import type { AppControl } from "./app-control.js";
import { registerAppRoutes } from "./routes/app.js";
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
  // Dossier du front exporté (`apps/web/out`). Présent : le backend sert aussi les pages, avec
  // une CSP adaptée à l'export statique de Next (scripts inline).
  staticDir?: string;
  // true : seule la machine locale peut ouvrir le studio (Host localhost). Les visiteurs qui
  // arrivent par le tunnel public ne peuvent alors que regarder et discuter.
  studioLocalOnly?: boolean;
  // Commandes de l'application installée (partage, arrêt). Absent en développement.
  appControl?: AppControl;
  // Identifiant d'instance exposé par /health : permet au lanceur de reconnaître SA propre
  // instance déjà démarrée (deuxième clic sur l'icône) sans inspecter les processus.
  instanceId?: string;
  // true derrière le tunnel Cloudflare du lanceur : le rate-limit compte l'IP réelle du visiteur
  // (`cf-connecting-ip`, posé par Cloudflare) au lieu de 127.0.0.1 pour tout le monde.
  trustCloudflareIp?: boolean;
  // Origines autorisées (CORS + WebSocket). Ensemble vivant : le lanceur y ajoute l'adresse du
  // tunnel quand elle apparaît. Défaut : CORS_ORIGIN.
  origins?: Set<string>;
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
  await app.register(helmet, {
    global: true,
    // L'export statique de Next injecte des scripts inline : la CSP par défaut (script-src
    // 'self') laisserait la page blanche. Le reste reste verrouillé sur l'origine.
    ...(options.staticDir === undefined
      ? {}
      : {
          contentSecurityPolicy: {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:"],
              mediaSrc: ["'self'", "blob:"],
              connectSrc: ["'self'", "ws:", "wss:"],
              workerSrc: ["'self'", "blob:"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              // L'app tourne en http://127.0.0.1 : « upgrade » casserait chaque requête (Firefox).
              upgradeInsecureRequests: null,
            },
          },
        }),
  });
  const origins = options.origins ?? new Set(config.CORS_ORIGIN);
  await app.register(cors, {
    origin: (origin, callback) => {
      // Pas d'en-tête Origin (même origine, curl) : pas de CORS à décider.
      callback(null, origin === undefined || origins.has(origin));
    },
    credentials: true,
    methods: ["GET", "PUT", "POST"],
  });
  await app.register(rateLimit, {
    global: false,
    ...(options.trustCloudflareIp === true
      ? {
          // `cf-connecting-ip` n'est digne de foi que sur le trajet du tunnel, où l'en-tête Host
          // est l'adresse publique : un client local qui le forge garde Host=localhost.
          keyGenerator: (request) => {
            const forwarded = request.headers["cf-connecting-ip"];
            const viaTunnel = !isLocalHost(request.headers.host);
            return viaTunnel && typeof forwarded === "string" && forwarded !== ""
              ? forwarded
              : request.ip;
          },
        }
      : {}),
    ...(options.redis === undefined ? {} : { redis: options.redis }),
  });

  // Anti-CSRF : une écriture venant d'une autre origine (page tierce visitée par le streameur)
  // est refusée, même si le cookie SameSite=Lax voyage (autre port de localhost = même site).
  // Sans Origin ni Sec-Fetch-Site (curl, webhook LiveKit, tests) : pas un navigateur, on laisse.
  app.addHook("onRequest", (request, _reply, done) => {
    const method = request.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      done();
      return;
    }
    const origin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    const crossSite = fetchSite === "cross-site" || fetchSite === "same-site";
    if ((origin !== undefined && !origins.has(origin)) || (origin === undefined && crossSite)) {
      done(new HttpError(403, "origin_not_allowed", "Origin not allowed."));
      return;
    }
    done();
  });

  // Studio réservé à cette machine : lanceur (studioLocalOnly) ou STUDIO_ACCESS=local. En mode
  // local, l'adresse TCP doit aussi être loopback : l'en-tête Host seul se forge depuis le réseau.
  const studioLocal = options.studioLocalOnly === true || config.STUDIO_ACCESS === "local";
  const requireLoopbackPeer = config.STUDIO_ACCESS === "local";
  if (studioLocal) {
    app.addHook("onRequest", (request, _reply, done) => {
      const opensStudio =
        request.method === "POST" && request.url.split("?")[0] === "/api/studio/open";
      const local =
        isLocalRequest(request.headers) &&
        (!requireLoopbackPeer || isLoopbackAddress(request.socket.remoteAddress));
      if (opensStudio && !local) {
        done(
          new HttpError(
            403,
            "studio_local_only",
            "The studio can only be opened from the machine running SoloCast.",
          ),
        );
        return;
      }
      done();
    });
  }

  app.decorateRequest("viewer", undefined);
  app.decorate("authMiddleware", authMiddleware);
  registerErrorHandlers(app, { htmlNotFound: options.staticDir !== undefined });

  const routeDeps = {
    streamerAuth,
    viewers,
    authMiddleware,
    cookies: {
      secure: config.COOKIE_SECURE,
      streamerName: config.SESSION_COOKIE_NAME,
      viewerName: config.VIEWER_COOKIE_NAME,
    },
    // Mode `key` : POST /api/studio/open exige STUDIO_KEY (vérifiée en temps constant).
    verifyStudioKey:
      config.STUDIO_ACCESS === "key" && config.STUDIO_KEY !== undefined
        ? createStudioKeyVerifier(config.STUDIO_KEY)
        : undefined,
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
  // Liveness probe (launcher, reverse proxy). No session, no store access.
  app.get("/health", async (_request, reply) =>
    reply.send(
      options.instanceId === undefined
        ? { status: "ok" }
        : { status: "ok", instance: options.instanceId },
    ),
  );

  registerStudioRoutes(app, routeDeps);
  registerMeRoutes(app, routeDeps);
  registerTokenRoutes(app, routeDeps);
  registerStageRoutes(app, routeDeps);
  registerModerationRoutes(app, routeDeps);
  if (options.appControl !== undefined) {
    registerAppRoutes(app, routeDeps, options.appControl);
  }

  await registerChatGateway(app, {
    hub,
    viewers,
    streamerAuth,
    capacity,
    store,
    cookies: { streamerName: config.SESSION_COOKIE_NAME, viewerName: config.VIEWER_COOKIE_NAME },
    allowedOrigins: origins,
    maxPayloadBytes: CHAT_WS_MAX_PAYLOAD_BYTES,
  });
  registerLiveKitWebhookRoutes(app, {
    verifier:
      options.livekitWebhookVerifier ??
      new WebhookReceiver(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET),
    hub,
    log: app.log,
  });

  // Front exporté : les chemins API/WS/webhooks sont déjà enregistrés plus haut, tout le reste
  // part vers les fichiers statiques (`/watch` -> `watch/index.html`).
  if (options.staticDir !== undefined) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      wildcard: true,
      setHeaders: (res, filePath) => {
        // Fichiers au nom haché de Next : jamais modifiés, donc cachables à vie.
        if (/[\\/]_next[\\/]static[\\/]/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
  }

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
