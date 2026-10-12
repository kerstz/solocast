import type { AuthMiddleware } from "../auth/middleware.js";
import type { StreamerAuth } from "../auth/streamer-auth.js";
import type { ViewerIdentityService } from "../auth/viewer-identity.js";
import type { ChatHub } from "../chat/hub.js";
import type { LiveKitGateway } from "../livekit/gateway.js";
import type { ViewerCapacity } from "../room/viewer-capacity.js";
import type { KeyValueStore } from "../state/key-value-store.js";
import type { StageNotifier } from "../stage/stage-notifier.js";
import type { StageRegistry } from "../stage/stage-registry.js";

export interface RouteDeps {
  streamerAuth: StreamerAuth;
  viewers: ViewerIdentityService;
  authMiddleware: AuthMiddleware;
  cookies: { secure: boolean; streamerName: string; viewerName: string };
  studioRateLimit: { max: number; timeWindow: number };
  tokenRateLimit: { max: number; timeWindow: number };
  livekit: LiveKitGateway;
  // URL WebSocket renvoyée au client dans TokenResponse.livekitUrl.
  livekitPublicWsUrl: string;
  stage: StageRegistry;
  // Plafond de viewers simultanés (MAX_VIEWERS) : /api/token prend la place comme la passerelle WS.
  capacity: ViewerCapacity;
  // Retrait de parole : Redis, coupure SFU, stage:revoked. Retourne le nom de l'erreur SFU éventuelle.
  revokeSpeaker: (viewerId: string) => Promise<string | undefined>;
  stageNotifier: StageNotifier;
  store: KeyValueStore;
  hub: ChatHub;
}
