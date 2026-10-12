import { MeResponseSchema, SetPseudoRequestSchema, type Role } from "@solocast/shared";
import type { FastifyInstance } from "fastify";
import { newViewerId, type ViewerIdentity } from "../auth/viewer-identity.js";
import { sessionCookieOptions } from "../http/cookies.js";
import type { RouteDeps } from "./shared-deps.js";

export function registerMeRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { streamerAuth, viewers, cookies } = deps;
  // Cookie viewer = cookie de session navigateur (pas de Max-Age). Le JWT expire après 24 h.
  const viewerCookie = sessionCookieOptions(cookies.secure);

  async function roleOf(streamerCookie: string | undefined): Promise<Role> {
    return (await streamerAuth.isAuthorized(streamerCookie)) ? "streamer" : "viewer";
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

  app.get("/api/me", async (request, reply) => {
    const { identity, isNew } = await resolveOrCreate(request.cookies[cookies.viewerName]);
    await viewers.assertNotBanned(identity.viewerId);
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
  app.put("/api/me/pseudo", async (request, reply) => {
    const body = SetPseudoRequestSchema.parse(request.body);
    const { identity } = await resolveOrCreate(request.cookies[cookies.viewerName]);
    await viewers.assertNotBanned(identity.viewerId);
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
  });
}
