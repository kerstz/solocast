import {
  MeResponseSchema,
  SetPseudoRequestSchema,
  ViewerIdSchema,
  type AppStatus,
  type BanRequest,
  type IngestResponse,
  type MeResponse,
  type SetPseudoRequest,
  type TokenResponse,
  type ViewerColor,
} from "@solocast/shared";
import { ApiError, type ViewerBackend } from "./types";
import {
  MockChatTransport,
  mockGrantSpeaker,
  mockRevokeSpeaker,
  mockStageGrants,
} from "./mockChat";

/**
 * Fake backend for dev and e2e (NEXT_PUBLIC_BACKEND_MODE=mock).
 * Demo data lives HERE only, never in components. The mock session is a non-httpOnly cookie:
 * this is a fake server, forbidden in production (see config.ts).
 */
const SESSION_COOKIE = "sc_mock_me";

interface MockSession {
  viewerId: string;
  pseudo: string | null;
  color: ViewerColor | null;
}

function randomId(): string {
  return crypto.randomUUID();
}

function readSession(): MockSession {
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`));
  if (match?.[1]) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1])) as MockSession;
      if (ViewerIdSchema.safeParse(parsed.viewerId).success) return parsed;
    } catch {
      // cookie corrompu : on repart d'une session neuve
    }
  }
  return { viewerId: randomId(), pseudo: null, color: null };
}

function writeSession(session: MockSession): void {
  const value = encodeURIComponent(JSON.stringify(session));
  document.cookie = `${SESSION_COOKIE}=${value}; path=/; SameSite=Lax`;
}

function toMe(session: MockSession): MeResponse {
  return MeResponseSchema.parse({
    role: "viewer",
    viewerId: session.viewerId,
    pseudo: session.pseudo,
    color: session.color,
  });
}

/** Simulated studio cookie: set by openStudio, never persisted beyond the tab. */
let mockStudioUnlocked = false;

/** Faux état de l'app installée : le partage « s'ouvre » après un court délai. */
let mockShare: AppStatus["share"] = { state: "off", url: null };
let mockQuit = false;

function mockAppStatus(): AppStatus {
  return {
    version: "mock",
    share: mockShare,
    video: true,
    ingest: true,
    mediaPorts: { tcp: 7881, udp: 7882 },
  };
}

export function createMockBackend(): ViewerBackend {
  return {
    mode: "mock",

    getMe(): Promise<MeResponse | null> {
      const session = readSession();
      writeSession(session);
      return Promise.resolve(toMe(session));
    },

    setPseudo(input: SetPseudoRequest): Promise<MeResponse> {
      const body = SetPseudoRequestSchema.parse(input);
      const session = readSession();
      const next: MockSession = {
        viewerId: session.viewerId,
        pseudo: body.pseudo,
        color: body.color ?? session.color ?? "#0000cc",
      };
      writeSession(next);
      return Promise.resolve(toMe(next));
    },

    openStudio(): Promise<void> {
      // Même contrat que le vrai serveur : l'ouverture prend la place, sans clé.
      mockStudioUnlocked = true;
      return Promise.resolve();
    },

    getIngest(): Promise<IngestResponse> {
      if (!mockStudioUnlocked) {
        return Promise.reject(new ApiError(403, "forbidden"));
      }
      return Promise.resolve({
        url: "rtmp://mock.solocast.invalid:1935/x",
        streamKey: "mock-stream-key-not-real",
      });
    },

    getAppStatus(): Promise<AppStatus | null> {
      if (!mockStudioUnlocked || mockQuit) return Promise.resolve(null);
      return Promise.resolve(mockAppStatus());
    },

    setShare(enabled: boolean): Promise<AppStatus> {
      mockShare = enabled
        ? { state: "on", url: "https://mock-demo-words.trycloudflare.com" }
        : { state: "off", url: null };
      return Promise.resolve(mockAppStatus());
    },

    quitApp(): Promise<void> {
      mockQuit = true;
      return Promise.resolve();
    },

    mintToken(): Promise<TokenResponse> {
      // Studio open: streamer token (video + audio). Otherwise a viewer token, audio only on grant.
      if (mockStudioUnlocked) {
        return Promise.resolve({
          livekitUrl: "wss://mock.solocast.invalid",
          token: "mock-token-not-a-real-jwt",
          identity: "streamer",
          canPublishVideo: true,
          canPublishAudio: true,
        });
      }
      const session = readSession();
      const granted = mockStageGrants.has(session.viewerId);
      return Promise.resolve({
        livekitUrl: "wss://mock.solocast.invalid",
        token: "mock-token-not-a-real-jwt",
        identity: session.viewerId,
        canPublishVideo: false,
        canPublishAudio: granted,
      });
    },

    openChat() {
      // Un faux serveur ne sait qu'une chose : si le studio est déverrouillé, la socket est streameur.
      if (mockStudioUnlocked) return new MockChatTransport(null, "streamer");
      return new MockChatTransport(readSession(), "viewer");
    },

    grantStage(viewerId: string): Promise<void> {
      mockGrantSpeaker(viewerId);
      return Promise.resolve();
    },

    revokeStage(viewerId: string): Promise<void> {
      mockRevokeSpeaker(viewerId);
      return Promise.resolve();
    },

    banViewer(input: BanRequest): Promise<void> {
      mockRevokeSpeaker(input.viewerId);
      return Promise.resolve();
    },
  };
}
