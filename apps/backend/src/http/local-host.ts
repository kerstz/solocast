import type { IncomingHttpHeaders } from "node:http";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** true si l'en-tête Host désigne cette machine (et non l'adresse publique du tunnel). */
export function isLocalHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined) return false;
  const host = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1)
    : (hostHeader.split(":")[0] ?? "");
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/**
 * Requête venue de cette machine : Host local ET aucune trace de Cloudflare. Le second critère
 * double le premier : un en-tête `cf-*` n'existe que sur le trajet du tunnel public.
 */
export function isLocalRequest(headers: IncomingHttpHeaders): boolean {
  if (headers["cf-connecting-ip"] !== undefined || headers["cf-ray"] !== undefined) return false;
  return isLocalHost(headers.host);
}

/** true si l'adresse de connexion TCP est celle de cette machine (IPv4, IPv6, IPv4 mappée). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
