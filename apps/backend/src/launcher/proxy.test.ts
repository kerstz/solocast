import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket, type RawData } from "ws";

const asText = (data: RawData): string => (Buffer.isBuffer(data) ? data.toString("utf8") : "");
import { createProxy } from "./proxy.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("proxy mono-origine", () => {
  it("laisse passer un WebSocket avec une première trame serveur immédiate", async () => {
    const upstream = createServer();
    const wss = new WebSocketServer({ server: upstream });
    // Trame envoyée dès l'ouverture : elle arrive souvent collée au 101 (le « head »).
    wss.on("connection", (socket) => {
      socket.send("hello");
      socket.on("message", (data) => {
        socket.send(`echo:${asText(data)}`);
      });
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = await listen(
      createProxy({ backend: { host: "127.0.0.1", port: upstreamPort } }),
    );

    const messages: string[] = [];
    const client = new WebSocket(`ws://127.0.0.1:${String(proxyPort)}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("message", (data) => {
        messages.push(asText(data));
        if (messages.length === 1) client.send("ping");
        if (messages.length === 2) resolve();
      });
    });
    client.close();
    expect(messages).toEqual(["hello", "echo:ping"]);
  });

  it("n'expose pas /webhooks, même encodé ou en majuscules", async () => {
    const upstream = createServer((_req, res) => {
      res.end("backend");
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = await listen(
      createProxy({ backend: { host: "127.0.0.1", port: upstreamPort } }),
    );
    for (const p of [
      "/webhooks/livekit",
      "/%77ebhooks/livekit",
      "/WebHooks/livekit",
      "//webhooks/x",
    ]) {
      const res = await fetch(`http://127.0.0.1:${String(proxyPort)}${p}`, { method: "POST" });
      expect(res.status, p).toBe(404);
    }
    const ok = await fetch(`http://127.0.0.1:${String(proxyPort)}/health`);
    expect(await ok.text()).toBe("backend");
  });
});
