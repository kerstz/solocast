import type { CookieSerializeOptions } from "@fastify/cookie";

// httpOnly + SameSite=Lax partout. Secure piloté par COOKIE_SECURE (true obligatoire en production).
export function sessionCookieOptions(
  secure: boolean,
  maxAgeSeconds?: number,
): CookieSerializeOptions {
  const options: CookieSerializeOptions = { httpOnly: true, sameSite: "lax", secure, path: "/" };
  if (maxAgeSeconds !== undefined) {
    options.maxAge = maxAgeSeconds;
  }
  return options;
}
