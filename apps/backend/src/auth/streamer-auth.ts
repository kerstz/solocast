import { randomUUID } from "node:crypto";
import type { KeyValueStore } from "../state/key-value-store.js";
import type { TokenCodec } from "./tokens.js";

export const STREAMER_SESSION_TTL_SECONDS = 12 * 60 * 60;
const STREAMER_SUBJECT = "streamer";

// Place unique du studio. Un seul détenteur à la fois : c'est lui, et personne d'autre, qui peut
// diffuser et modérer. Le bail est court et renouvelé tant que le studio est connecté (hub tick).
// Ouvrir le studio prend la place même si elle est tenue : sans clé d'entrée, un bail orphelin
// (onglet fermé brutalement) ne doit pas verrouiller le studio pendant deux minutes.
export const STUDIO_SLOT_KEY = "studio:holder:main";
export const STUDIO_LEASE_TTL_SECONDS = 120;
const STUDIO_MAX_HOLDERS = 1;

const sessionKey = (tokenId: string): string => `studio:session:${tokenId}`;

export interface StreamerAuthDeps {
  codec: TokenCodec;
  store: KeyValueStore;
}

export interface StreamerSession {
  tokenId: string;
}

/**
 * Session studio. Aucune clé d'entrée : ouvrir /studio suffit. Un seul studio tient la place à la
 * fois — la dernière ouverture prend le bail et invalide le cookie du précédent détenteur, dont
 * les routes streameur cessent aussitôt de répondre.
 */
export interface StreamerAuth {
  /** Jeton de session du nouveau détenteur du studio. */
  open(previousToken: string | undefined): Promise<string>;
  close(token: string | undefined): Promise<void>;
  /** Session of a valid studio cookie that still holds the lease, `null` otherwise. */
  session(token: string | undefined): Promise<StreamerSession | null>;
  isAuthorized(token: string | undefined): Promise<boolean>;
  /** Extends the lease of the current holder. No-op for anyone else. */
  renewLease(tokenId: string): Promise<void>;
}

export function createStreamerAuth(deps: StreamerAuthDeps): StreamerAuth {
  const { codec, store } = deps;

  async function revoke(token: string | undefined): Promise<void> {
    if (token === undefined) {
      return;
    }
    const verified = await codec.verify("streamer", token);
    if (verified !== null) {
      await store.delete(sessionKey(verified.tokenId));
      await store.releaseSlot(STUDIO_SLOT_KEY, verified.tokenId);
    }
  }

  const auth: StreamerAuth = {
    async open(previousToken) {
      // Re-opening from the same browser releases its own lease first, then takes it again.
      await revoke(previousToken);
      // Prise de la place : le bail du détenteur précédent est écarté, son cookie ne commande
      // plus rien (session() exige le bail). Un seul studio reste actif à la fois.
      await store.clearSlots(STUDIO_SLOT_KEY);
      const tokenId = randomUUID();
      await store.takeSlot(
        STUDIO_SLOT_KEY,
        tokenId,
        STUDIO_LEASE_TTL_SECONDS,
        STUDIO_MAX_HOLDERS,
      );
      const token = await codec.sign({
        audience: "streamer",
        subject: STREAMER_SUBJECT,
        tokenId,
        ttlSeconds: STREAMER_SESSION_TTL_SECONDS,
        pseudo: undefined,
      });
      await store.set(sessionKey(tokenId), "1", STREAMER_SESSION_TTL_SECONDS);
      return token;
    },

    close: revoke,

    async session(token) {
      if (token === undefined) {
        return null;
      }
      const verified = await codec.verify("streamer", token);
      if (verified === null) {
        return null;
      }
      // Both must hold: a valid session record AND the studio lease. A cookie whose lease expired
      // (studio closed, someone else took the studio) no longer commands anything.
      if (!(await store.exists(sessionKey(verified.tokenId)))) {
        return null;
      }
      if (!(await store.hasSlot(STUDIO_SLOT_KEY, verified.tokenId))) {
        return null;
      }
      return { tokenId: verified.tokenId };
    },

    async isAuthorized(token) {
      return (await auth.session(token)) !== null;
    },

    async renewLease(tokenId) {
      // `takeSlot` on an existing member extends it; on a full set with another holder it fails,
      // which is exactly the wanted no-op.
      await store.takeSlot(STUDIO_SLOT_KEY, tokenId, STUDIO_LEASE_TTL_SECONDS, STUDIO_MAX_HOLDERS);
    },
  };

  return auth;
}
