/**
 * Reverse proxy used by start.sh: one public origin in front of the two dev servers.
 *
 *   /api/*, /health, /webhooks/*, /ws   ->  backend  (127.0.0.1:3000)
 *   everything else                      ->  Next.js  (127.0.0.1:3001)
 *
 * One origin is what makes a shared tunnel work at all: the session cookie (SameSite=Lax) and
 * the WebSocket handshake both stay same-site, and the backend CORS allowlist holds a single URL.
 * Node core only — no dependency, no TLS here (the tunnel terminates HTTPS).
 */

import { createServer, request as httpRequest } from "node:http";

const PORT = Number(process.env.SHARE_PORT ?? 8080);
const BACKEND = { host: "127.0.0.1", port: Number(process.env.BACKEND_PORT ?? 3000) };
const WEB = { host: "127.0.0.1", port: Number(process.env.WEB_PORT ?? 3001) };
const BACKEND_PREFIXES = ["/api/", "/ws", "/health", "/webhooks/"];

/** Backend paths are an explicit list: anything else belongs to the Next.js app. */
function targetFor(url) {
  const path = url.split("?")[0] ?? "/";
  const toBackend = BACKEND_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix),
  );
  return toBackend ? BACKEND : WEB;
}

const server = createServer((req, res) => {
  const target = targetFor(req.url ?? "/");
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
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("Upstream not ready.\n");
  });
  req.pipe(upstream);
});

// WebSocket upgrades: /ws goes to the chat gateway, the rest is the Next dev HMR socket.
server.on("upgrade", (req, socket, head) => {
  const target = targetFor(req.url ?? "/");
  const upstream = httpRequest({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: req.headers,
  });
  upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(upstreamRes.headers).map(
      ([key, value]) => `${key}: ${String(value)}`,
    );
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length > 0) socket.unshift(upstreamHead);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  });
  upstream.on("response", (upstreamRes) => {
    // Upgrade refused (bad origin, missing cookie): pass the status through, then close.
    socket.write(
      `HTTP/1.1 ${String(upstreamRes.statusCode ?? 502)} ${upstreamRes.statusMessage ?? ""}\r\n\r\n`,
    );
    socket.destroy();
  });
  upstream.on("error", () => socket.destroy());
  if (head.length > 0) upstream.write(head);
  upstream.end();
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`share proxy on http://127.0.0.1:${String(PORT)}\n`);
});
