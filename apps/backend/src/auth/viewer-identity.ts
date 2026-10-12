import { randomUUID } from "node:crypto";
import {
  PseudoSchema,
  ViewerColorSchema,
  ViewerIdSchema,
  type ViewerColor,
} from "@solocast/shared";
import { HttpError } from "../http/errors.js";
import type { KeyValueStore } from "../state/key-value-store.js";
import type { TokenCodec } from "./tokens.js";

export const VIEWER_SESSION_TTL_SECONDS = 24 * 60 * 60;

// Clé Redis des bans viewer (écrite par WP3). Indexée sur viewerId, jamais sur le pseudo.
export const banKey = (viewerId: string): string => `ban:${viewerId}`;

export interface ViewerIdentity {
  viewerId: string;
  pseudo: string | null;
  // Couleur du pseudo dans le chat (palette fermée VIEWER_COLORS). Aucune autorité.
  color: ViewerColor | null;
}

export interface ViewerIdentityDeps {
  codec: TokenCodec;
  store: KeyValueStore;
}

export interface ViewerIdentityService {
  resolve(token: string | undefined): Promise<ViewerIdentity | null>;
  issue(viewerId: string, pseudo: string | null, color: ViewerColor | null): Promise<string>;
  assertNotBanned(viewerId: string): Promise<void>;
}

// Identifiant opaque aléatoire émis par le serveur. Aucun compte, aucun mot de passe.
export const newViewerId = (): string => randomUUID();

export function createViewerIdentity(deps: ViewerIdentityDeps): ViewerIdentityService {
  const { codec, store } = deps;

  return {
    async resolve(token) {
      if (token === undefined) {
        return null;
      }
      const verified = await codec.verify("viewer", token);
      if (verified === null) {
        return null;
      }
      const viewerId = ViewerIdSchema.safeParse(verified.subject);
      if (!viewerId.success) {
        return null;
      }
      // Pseudo et couleur sont de simples libellés : revalidés à chaque lecture, sans autorité.
      const pseudo = verified.pseudo === undefined ? null : PseudoSchema.safeParse(verified.pseudo);
      const color =
        verified.color === undefined ? null : ViewerColorSchema.safeParse(verified.color);
      return {
        viewerId: viewerId.data,
        pseudo: pseudo === null || !pseudo.success ? null : pseudo.data,
        color: color === null || !color.success ? null : color.data,
      };
    },

    issue(viewerId, pseudo, color) {
      return codec.sign({
        audience: "viewer",
        subject: viewerId,
        tokenId: randomUUID(),
        ttlSeconds: VIEWER_SESSION_TTL_SECONDS,
        pseudo: pseudo ?? undefined,
        color: color ?? undefined,
      });
    },

    async assertNotBanned(viewerId) {
      if (await store.exists(banKey(viewerId))) {
        throw new HttpError(403, "viewer_banned", "Access denied.");
      }
    },
  };
}
