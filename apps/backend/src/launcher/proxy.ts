import { createServer, request as httpRequest, type Server } from "node:http";
import type { Socket } from "node:net";

export interface Upstream {
  host: string;
  port: number;
}

export interface ProxyTargets {
  backend: Upstream;
  // Signalisation WebRTC du SFU (`/rtc`) : absent si LiveKit n'est pas installé.
  livekit?: Upstream;
}

// Les webhooks du SFU arrivent directement sur le backend (127.0.0.1) : jamais par l'adresse
// publique, où ils n'ont aucune raison d'être.
function isBlocked(path: string): boolean {
  return path === "/webhooks" || path.startsWith("/webhooks/");
}

// Chemin normalisé (décodé, sans // ni casse) : `/%77ebhooks` ou `//webhooks` ne doivent pas passer.
function pathOf(url: string | undefined): string {
  let path = (url ?? "/").split("?")[0] ?? "/";
  try {
    path = decodeURIComponent(path);
  } catch {
    return "/__invalid__";
  }
  return path.replace(/\/{2,}/g, "/").toLowerCase();
}

/**
 * Une seule origine devant le site, l'API, le WebSocket du chat et la signalisation LiveKit :
 * c'est ce qui fait tenir le cookie de session (SameSite=Lax) et l'allowlist CORS à travers un
 * tunnel. `/rtc*` va au SFU, tout le reste au backend. Node seul, pas de dépendance.
 */
export function createProxy(targets: ProxyTargets): Server {
  const targetFor = (url: string | undefined): Upstream | null => {
    const path = pathOf(url);
    if (isBlocked(path)) return null;
    if (targets.livekit !== undefined && (path === "/rtc" || path.startsWith("/rtc/"))) {
      return targets.livekit;
    }
    return targets.backend;
  };

  const server = createServer((req, res) => {
    const target = targetFor(req.url);
    if (target === null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found.\n");
      return;
    }
    const upstream = httpRequest(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    // Une réponse du backend qui n'arrive jamais ne doit pas retenir la connexion client.
    upstream.setTimeout(30_000, () => {
      upstream.destroy();
      res.destroy();
    });
    upstream.on("error", () => {
      if (res.headersSent) {
        // Réponse déjà entamée : on ne peut plus la compléter proprement, on coupe.
        res.destroy();
        return;
      }
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Upstream not ready.\n");
    });
    req.pipe(upstream);
  });
  // Exposé sur internet par le tunnel : bornes contre les connexions lentes ou nombreuses.
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 30_000;
  // Compte aussi les sockets WebSocket (≈ 2 par spectateur : chat + /rtc).
  server.maxConnections = 1_024;

  server.on("upgrade", (req, socket: Socket, head) => {
    const target = targetFor(req.url);
    if (target === null) {
      socket.destroy();
      return;
    }
    const upstream = httpRequest({
      host: target.host,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    });
    upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      const headers = Object.entries(upstreamRes.headers).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map((v) => `${key}: ${String(v)}`),
      );
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
      // Octets déjà lus après le 101 : ils appartiennent au client, pas au serveur.
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      upstreamSocket.on("error", () => socket.destroy());
      socket.on("error", () => upstreamSocket.destroy());
    });
    upstream.on("response", (upstreamRes) => {
      // Upgrade refusé (origine ou cookie) : on relaie le statut, puis on ferme.
      socket.write(
        `HTTP/1.1 ${String(upstreamRes.statusCode ?? 502)} ${upstreamRes.statusMessage ?? ""}\r\n\r\n`,
      );
      socket.destroy();
    });
    upstream.on("error", () => socket.destroy());
    if (head.length > 0) upstream.write(head);
    upstream.end();
  });

  return server;
}
