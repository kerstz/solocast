import { SignJWT, jwtVerify } from "jose";

// Deux audiences distinctes : un jeton viewer n'est jamais accepté comme jeton streameur.
export type TokenAudience = "streamer" | "viewer";

export interface VerifiedToken {
  subject: string;
  tokenId: string;
  pseudo: string | undefined;
  // Couleur de pseudo choisie par le viewer (simple libellé, aucune autorité).
  color: string | undefined;
}

export interface SignTokenInput {
  audience: TokenAudience;
  subject: string;
  tokenId: string;
  ttlSeconds: number;
  pseudo: string | undefined;
  color?: string | undefined;
}

export interface TokenCodec {
  sign(input: SignTokenInput): Promise<string>;
  verify(audience: TokenAudience, token: string): Promise<VerifiedToken | null>;
}

export function createTokenCodec(secret: string): TokenCodec {
  const key = new TextEncoder().encode(secret);

  return {
    sign({ audience, subject, tokenId, ttlSeconds, pseudo, color }) {
      const claims: Record<string, string> = {
        ...(pseudo === undefined ? {} : { pseudo }),
        ...(color === undefined ? {} : { color }),
      };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(subject)
        .setAudience(audience)
        .setJti(tokenId)
        .setIssuedAt()
        .setExpirationTime(`${String(ttlSeconds)}s`)
        .sign(key);
    },

    async verify(audience, token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ["HS256"],
          audience,
        });
        if (typeof payload.sub !== "string" || typeof payload.jti !== "string") {
          return null;
        }
        return {
          subject: payload.sub,
          tokenId: payload.jti,
          pseudo: typeof payload.pseudo === "string" ? payload.pseudo : undefined,
          color: typeof payload.color === "string" ? payload.color : undefined,
        };
      } catch {
        // Jeton absent de la base, expiré, mal signé ou d'une autre audience : traité comme absent.
        // Le jeton n'est jamais journalisé.
        return null;
      }
    },
  };
}
