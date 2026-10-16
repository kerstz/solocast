import { createHmac } from "node:crypto";
import { isLoopbackAddress } from "../http/local-host.js";
import type { KeyValueStore } from "../state/key-value-store.js";

// Empreinte IP : HMAC-SHA256 (clé dérivée de JWT_SECRET), tronquée. L'IP en clair n'est jamais
// stockée ; sans le secret, l'empreinte ne se renverse pas par énumération des 2^32 adresses.
const FINGERPRINT_HEX_LENGTH = 32;

const viewerIpKey = (viewerId: string): string => `viewerip:${viewerId}`;
const ipBanKey = (fingerprint: string): string => `banip:${fingerprint}`;

export interface IpBans {
  /** Associe l'empreinte de l'IP courante au viewer (pour pouvoir la bannir plus tard). */
  remember(viewerId: string, ip: string): Promise<void>;
  /** true si l'IP est sous le coup d'un ban (effacer son cookie ne suffit donc pas). */
  isBanned(ip: string): Promise<boolean>;
  /**
   * Bannit la dernière IP connue du viewer, pour au plus `maxTtlSeconds` (BAN_IP_TTL_SECONDS) :
   * une IP se partage (CGNAT, Wi-Fi public), un ban d'IP permanent toucherait des innocents.
   */
  banViewerIp(viewerId: string, ttlSeconds: number | undefined): Promise<boolean>;
}

export function createIpBans(deps: {
  store: KeyValueStore;
  secret: string;
  maxTtlSeconds: number;
  // Durée de l'association viewer -> empreinte (durée de vie du jeton viewer).
  rememberTtlSeconds: number;
}): IpBans {
  const { store } = deps;
  const hmacKey = createHmac("sha256", deps.secret).update("solocast:ip-fingerprint:v1").digest();
  const fingerprint = (ip: string): string =>
    createHmac("sha256", hmacKey)
      .update(ip.toLowerCase().replace(/^::ffff:/, ""))
      .digest("hex")
      .slice(0, FINGERPRINT_HEX_LENGTH);
  // Cette machine (lanceur, streameur) n'est jamais bannie par IP : elle porte aussi le studio.
  const bannable = (ip: string): boolean => ip !== "" && !isLoopbackAddress(ip);

  return {
    async remember(viewerId, ip) {
      if (!bannable(ip)) return;
      await store.set(viewerIpKey(viewerId), fingerprint(ip), deps.rememberTtlSeconds);
    },
    async isBanned(ip) {
      if (!bannable(ip)) return false;
      return store.exists(ipBanKey(fingerprint(ip)));
    },
    async banViewerIp(viewerId, ttlSeconds) {
      const known = await store.get(viewerIpKey(viewerId));
      if (known === null) return false;
      const ttl = Math.min(ttlSeconds ?? deps.maxTtlSeconds, deps.maxTtlSeconds);
      await store.set(ipBanKey(known), "1", ttl);
      return true;
    },
  };
}
