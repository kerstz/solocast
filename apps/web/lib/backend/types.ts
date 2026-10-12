import type {
  BanRequest,
  IngestResponse,
  MeResponse,
  SetPseudoRequest,
  TokenResponse,
} from "@solocast/shared";
import type { ChatTransport } from "../chat/transport";

export type ApiErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  // 409 : le studio est déjà tenu par un autre streameur (un seul à la fois).
  | "conflict"
  | "rate_limited"
  // 503 : plafond MAX_VIEWERS atteint.
  | "room_full"
  | "network"
  | "server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

/**
 * Single interface to the backend. Two implementations: `http` (real contracts) and `mock`
 * (dev / e2e). The UI never knows which one is active, and no method carries a secret or a
 * client-decided role.
 */
export interface ViewerBackend {
  readonly mode: "http" | "mock";
  /** GET /api/me. `null` when there is no session. */
  getMe(): Promise<MeResponse | null>;
  /** PUT /api/me/pseudo: username + colour chosen in the browser, with no authority. */
  setPseudo(input: SetPseudoRequest): Promise<MeResponse>;
  /** POST /api/studio/open: takes the single studio slot and sets the studio cookie. */
  openStudio(): Promise<void>;
  /** POST /api/studio/ingest (streamer): RTMP address + stream key of the LiveKit Ingress. */
  getIngest(): Promise<IngestResponse>;
  /** POST /api/token: server-signed LiveKit token (subscribe-only unless the stage was granted). */
  mintToken(): Promise<TokenResponse>;
  /** Opens the chat socket (/ws). Authenticated by cookie at connection time. */
  openChat(): ChatTransport;
  /** POST /api/stage/grant (streamer). A request only: the server decides and answers 204. */
  grantStage(viewerId: string): Promise<void>;
  /** POST /api/stage/revoke (streamer): the server cuts the viewer's publishing right. */
  revokeStage(viewerId: string): Promise<void>;
  /** POST /api/moderation/ban (streamer). Target = viewerId, never the username. */
  banViewer(input: BanRequest): Promise<void>;
}
