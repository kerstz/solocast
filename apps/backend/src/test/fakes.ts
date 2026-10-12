import { randomBytes } from "node:crypto";
import { MemoryKeyValueStore } from "../state/key-value-store.js";

export { MemoryKeyValueStore };
import type { IngestResponse } from "@solocast/shared";
import type { LiveKitGateway } from "../livekit/gateway.js";
import type { MediaGrant, MediaPermission } from "../livekit/grants.js";
import type { StageNotification, StageNotifier } from "../stage/stage-notifier.js";

// Passerelle SFU factice : enregistre les grants et les mises à jour, sans réseau.
export class FakeLiveKitGateway implements LiveKitGateway {
  readonly grants: MediaGrant[] = [];
  readonly updates: { identity: string; permission: MediaPermission }[] = [];
  // Si défini, updateParticipant échoue avec cette erreur (simule un SFU indisponible).
  failUpdates: Error | undefined = undefined;
  readonly removals: string[] = [];
  // Si false, updateParticipant signale un participant absent du SFU.
  participantConnected = true;
  // Nombre d'appels à ensureRoom (la room doit être créée avant toute émission de jeton).
  roomEnsured = 0;
  // Si défini, ensureRoom échoue avec cette erreur (simule un SFU injoignable).
  failEnsureRoom: Error | undefined = undefined;
  // Réponse d'ensureIngress : `null` = service Ingress injoignable.
  ingress: IngestResponse | null = { url: "rtmp://localhost:1935/x", streamKey: "fake-stream-key" };

  ensureRoom(): Promise<void> {
    this.roomEnsured += 1;
    if (this.failEnsureRoom !== undefined) {
      return Promise.reject(this.failEnsureRoom);
    }
    return Promise.resolve();
  }

  ensureIngress(): Promise<IngestResponse | null> {
    return Promise.resolve(this.ingress);
  }

  createToken(grant: MediaGrant): Promise<string> {
    this.grants.push(grant);
    return Promise.resolve(`fake-livekit-token-${String(this.grants.length)}`);
  }

  updateParticipant(identity: string, permission: MediaPermission): Promise<boolean> {
    this.updates.push({ identity, permission });
    if (this.failUpdates !== undefined) {
      return Promise.reject(this.failUpdates);
    }
    return Promise.resolve(this.participantConnected);
  }

  removeParticipant(identity: string): Promise<boolean> {
    this.removals.push(identity);
    return Promise.resolve(this.participantConnected);
  }
}

// Notifier qui conserve les événements émis (remplace le no-op de WP2 dans les tests).
export class RecordingStageNotifier implements StageNotifier {
  readonly events: StageNotification[] = [];

  notify(notification: StageNotification): Promise<void> {
    this.events.push(notification);
    return Promise.resolve();
  }
}

// Environnement de test : secrets générés à chaque exécution (aucun secret en dur dans le dépôt).
export function createTestEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: "3000",
    REDIS_URL: "redis://:unused@127.0.0.1:6379/0",
    JWT_SECRET: randomBytes(32).toString("hex"),
    CORS_ORIGIN: "http://localhost:3001",
    COOKIE_SECURE: "false",
    SESSION_COOKIE_NAME: "sc_session",
    VIEWER_COOKIE_NAME: "sc_viewer",
    STUDIO_RATE_LIMIT_MAX: "30",
    STUDIO_RATE_LIMIT_WINDOW_MS: "60000",
    LIVEKIT_URL: "http://127.0.0.1:7880",
    LIVEKIT_PUBLIC_WS_URL: "ws://127.0.0.1:7880",
    LIVEKIT_API_KEY: "test-livekit-key",
    LIVEKIT_API_SECRET: randomBytes(32).toString("hex"),
    LIVEKIT_TOKEN_TTL_SECONDS: "600",
    ROOM_NAME: "main",
    MAX_SPEAKERS: "8",
    ...overrides,
  };
}
