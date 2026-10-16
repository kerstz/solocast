import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Vérifie la clé d'entrée du studio (STUDIO_KEY) en temps constant. Les deux valeurs sont d'abord
 * condensées (SHA-256) : la comparaison porte sur des tampons de même longueur, quelle que soit la
 * saisie, et la clé en clair ne reste pas dans la fermeture. La clé fait >= 32 octets aléatoires
 * (config.ts) : un hachage lent n'apporterait rien contre la force brute, déjà bornée par le
 * rate-limit de POST /api/studio/open.
 */
export function createStudioKeyVerifier(key: string): (candidate: string | undefined) => boolean {
  const expected = digest(key);
  return (candidate) => {
    if (candidate === undefined || candidate === "") {
      return false;
    }
    return timingSafeEqual(digest(candidate), expected);
  };
}
