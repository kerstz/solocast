import type { FastifyRequest } from "fastify";
import { HttpError } from "../http/errors.js";
import type { StreamerAuth } from "./streamer-auth.js";
import type { ViewerIdentity, ViewerIdentityService } from "./viewer-identity.js";

declare module "fastify" {
  interface FastifyRequest {
    viewer: ViewerIdentity | undefined;
  }
  interface FastifyInstance {
    authMiddleware: AuthMiddleware;
  }
}

export interface AuthMiddleware {
  requireStreamer: (request: FastifyRequest) => Promise<void>;
  requireViewer: (request: FastifyRequest) => Promise<void>;
}

export interface AuthMiddlewareDeps {
  streamerAuth: StreamerAuth;
  viewers: ViewerIdentityService;
  streamerCookieName: string;
  viewerCookieName: string;
}

// Fail-closed : sans cookie streameur valide (signature, audience, session Redis active), 403.
export function createAuthMiddleware(deps: AuthMiddlewareDeps): AuthMiddleware {
  return {
    async requireStreamer(request) {
      const authorized = await deps.streamerAuth.isAuthorized(
        request.cookies[deps.streamerCookieName],
      );
      if (!authorized) {
        throw new HttpError(403, "forbidden", "Studio session required.");
      }
    },

    async requireViewer(request) {
      const identity = await deps.viewers.resolve(request.cookies[deps.viewerCookieName]);
      if (identity === null) {
        throw new HttpError(401, "viewer_identity_required", "Viewer identity required.");
      }
      await deps.viewers.assertNotBanned(identity.viewerId);
      request.viewer = identity;
    },
  };
}
