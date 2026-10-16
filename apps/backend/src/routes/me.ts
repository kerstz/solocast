import { MeResponseSchema, SetPseudoRequestSchema, type Role } from "@solocast/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { newViewerId, type ViewerIdentity } from "../auth/viewer-identity.js";
import { HttpError } from "../http/errors.js";
import { sessionCookieOptions } from "../http/cookies.js";
import type { RouteDeps } from "./shared-deps.js";

// Routes sans authentification qui signent un jeton : plafonnées par IP (60/min, large pour un
// rechargement de page, étroit pour une inondation).
const IDENTITY_RATE_LIMIT = { max: 60, timeWindow: 60_000 };

export function registerMeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { streamerAuth, viewers, cookies, ipBans } = deps;
  // Cookie viewer = cookie de session navigateur (pas de Max-Age). Le JWT expire après 24 h.
  const viewerCookie = sessionCookieOptions(cookies.secure);

  async function roleOf(streamerCookie: string | undefined): Promise<Role> {
    return (await streamerAuth.isAuthorized(streamerCookie)) ? "streamer" : "viewer";
  }

  // Ban par identité ET par empreinte d'IP : effacer son cookie ne contourne pas un ban.
  // L'empreinte de l'IP est associée au viewer pour qu'un futur ban puisse la viser.
  async function assertAllowed(request: FastifyRequest, viewerId: string): Promise<void> {
    const ip = deps.clientIp(request);
    if (await ipBans.isBanned(ip)) {
      throw new HttpError(403, "viewer_banned", "Access denied.");
    }
    await viewers.assertNotBanned(viewerId);
    await ipBans.remember(viewerId, ip);
  }

  async function resolveOrCreate(
    viewerCookie: string | undefined,
  ): Promise<{ identity: ViewerIdentity; isNew: boolean }> {
    const existing = await viewers.resolve(viewerCookie);
    if (existing !== null) {
      return { identity: existing, isNew: false };
    }
    return { identity: { viewerId: newViewerId(), pseudo: null, color: null }, isNew: true };
  }

  app.get("/api/me", { config: { rateLimit: IDENTITY_RATE_LIMIT } }, async (request, reply) => {
    const { identity, isNew } = await resolveOrCreate(request.cookies[cookies.viewerName]);
    await assertAllowed(request, identity.viewerId);
    if (isNew) {
      const token = await viewers.issue(identity.viewerId, identity.pseudo, identity.color);
      reply.setCookie(cookies.viewerName, token, viewerCookie);
    }
    const role = await roleOf(request.cookies[cookies.streamerName]);
    return reply.send(
      MeResponseSchema.parse({
        role,
        viewerId: identity.viewerId,
        pseudo: identity.pseudo,
        color: identity.color,
      }),
    );
  });

  // Pseudo et couleur sont des libellés choisis par le client : ils changent le jeton viewer,
  // jamais l'identité (viewerId) ni un droit. La couleur est restreinte à la palette partagée.
  app.put(
    "/api/me/pseudo",
    { config: { rateLimit: IDENTITY_RATE_LIMIT } },
    async (request, reply) => {
      const body = SetPseudoRequestSchema.parse(request.body);
      const { identity } = await resolveOrCreate(request.cookies[cookies.viewerName]);
      await assertAllowed(request, identity.viewerId);
      const color = body.color ?? identity.color;
      const token = await viewers.issue(identity.viewerId, body.pseudo, color);
      reply.setCookie(cookies.viewerName, token, viewerCookie);
      const role = await roleOf(request.cookies[cookies.streamerName]);
      return reply.send(
        MeResponseSchema.parse({
          role,
          viewerId: identity.viewerId,
          pseudo: body.pseudo,
          color,
        }),
      );
    },
  );
}
