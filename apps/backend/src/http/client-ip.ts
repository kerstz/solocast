import type { FastifyRequest } from "fastify";
import { isLocalHost } from "./local-host.js";

export type ClientIpResolver = (request: FastifyRequest) => string;

/**
 * Adresse IP du client, la même pour le rate-limit, le plafond WebSocket et le ban par IP.
 * `cf-connecting-ip` n'est digne de foi que derrière le tunnel du lanceur (`trustCloudflareIp`) et
 * sur le trajet du tunnel, où l'en-tête Host est l'adresse publique : un client local qui le forge
 * garde Host=localhost. Sinon `request.ip` (qui suit TRUST_PROXY / X-Forwarded-For).
 */
export function createClientIpResolver(trustCloudflareIp: boolean): ClientIpResolver {
  return (request) => {
    if (trustCloudflareIp) {
      const forwarded = request.headers["cf-connecting-ip"];
      const viaTunnel = !isLocalHost(request.headers.host);
      if (viaTunnel && typeof forwarded === "string" && forwarded !== "") {
        return forwarded;
      }
    }
    return request.ip;
  };
}
