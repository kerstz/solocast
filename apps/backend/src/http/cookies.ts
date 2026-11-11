import type { CookieSerializeOptions } from "@fastify/cookie";

// httpOnly partout ; SameSite=Lax (viewer) ou Strict (studio, passé par studio.ts). Secure piloté par COOKIE_SECURE (true obligatoire en production).
export function sessionCookieOptions(
  secure: boolean,
  maxAgeSeconds?: number,
  sameSite: "lax" | "strict" = "lax",
): CookieSerializeOptions {
  const options: CookieSerializeOptions = { httpOnly: true, sameSite, secure, path: "/" };
  if (maxAgeSeconds !== undefined) {
    options.maxAge = maxAgeSeconds;
  }
  return options;
}
