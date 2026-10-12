import type { ZodType } from "zod";
import {
  BanRequestSchema,
  IngestResponseSchema,
  MeResponseSchema,
  SetPseudoRequestSchema,
  StageViewerRequestSchema,
  TokenResponseSchema,
} from "@solocast/shared";
import type {
  BanRequest,
  IngestResponse,
  MeResponse,
  SetPseudoRequest,
  TokenResponse,
} from "@solocast/shared";
import { createBrowserTransport } from "../chat/transport";
import { ApiError, type ApiErrorCode, type ViewerBackend } from "./types";

interface HttpConfig {
  apiBaseUrl: string;
  wsUrl: string;
}

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "invalid_input";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "room_full";
  return "server";
}

/** Real backend: cookies handled by the browser (credentials: include), no token in JS. */
export function createHttpBackend(cfg: HttpConfig): ViewerBackend {
  async function call(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const init: RequestInit = {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    let res: Response;
    try {
      res = await fetch(`${cfg.apiBaseUrl}${path}`, init);
    } catch {
      throw new ApiError(0, "network");
    }
    if (!res.ok) {
      // Le corps d'erreur serveur n'est pas affiché tel quel : le front mappe un code i18n.
      throw new ApiError(res.status, codeFromStatus(res.status));
    }
    return res;
  }

  async function parse<T>(res: Response, schema: ZodType<T>): Promise<T> {
    const raw: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ApiError(res.status, "server");
    return parsed.data;
  }

  return {
    mode: "http",

    async getMe(): Promise<MeResponse | null> {
      try {
        const res = await call("GET", "/api/me");
        return await parse(res, MeResponseSchema);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },

    async setPseudo(input: SetPseudoRequest): Promise<MeResponse> {
      const body = SetPseudoRequestSchema.parse(input);
      const res = await call("PUT", "/api/me/pseudo", body);
      return parse(res, MeResponseSchema);
    },

    async openStudio(): Promise<void> {
      await call("POST", "/api/studio/open");
    },

    async getIngest(): Promise<IngestResponse> {
      const res = await call("POST", "/api/studio/ingest");
      return parse(res, IngestResponseSchema);
    },

    async mintToken(): Promise<TokenResponse> {
      const res = await call("POST", "/api/token");
      return parse(res, TokenResponseSchema);
    },

    openChat() {
      return createBrowserTransport(cfg.wsUrl);
    },

    async grantStage(viewerId: string): Promise<void> {
      const body = StageViewerRequestSchema.parse({ viewerId });
      await call("POST", "/api/stage/grant", body);
    },

    async revokeStage(viewerId: string): Promise<void> {
      const body = StageViewerRequestSchema.parse({ viewerId });
      await call("POST", "/api/stage/revoke", body);
    },

    async banViewer(input: BanRequest): Promise<void> {
      const body = BanRequestSchema.parse(input);
      await call("POST", "/api/moderation/ban", body);
    },
  };
}
