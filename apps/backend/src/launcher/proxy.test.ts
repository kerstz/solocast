import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, type Socket } from "node:net";
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

  it("refuse les segments . et .. (même encodés) au lieu de sortir du préfixe /rtc", async () => {
    const hits: string[] = [];
    const backend = createServer((req, res) => {
      hits.push(`backend${req.url ?? ""}`);
      res.end("backend");
    });
    const sfu = createServer((req, res) => {
      hits.push(`sfu${req.url ?? ""}`);
      res.end("sfu");
    });
    const backendPort = await listen(backend);
    const sfuPort = await listen(sfu);
    const proxyPort = await listen(
      createProxy({
        backend: { host: "127.0.0.1", port: backendPort },
        livekit: { host: "127.0.0.1", port: sfuPort },
      }),
    );
    // fetch() normalise l'URL côté client : on envoie le chemin tel quel.
    const status = (path: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port: proxyPort, method: "POST", path },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
    for (const p of [
      "/rtc/../twirp/livekit.RoomService/DeleteRoom",
      "/rtc/%2e%2e/twirp/x",
      "/rtc/%2E%2E/%2e%2e/webhooks/livekit",
      "/api/../webhooks/livekit",
    ]) {
      expect(await status(p), p).toBe(404);
    }
    expect(hits).toEqual([]);
    expect(await status("/rtc/v1?access_token=x")).toBe(200);
    expect(hits).toEqual(["sfu/rtc/v1?access_token=x"]);
  });

  it("survit à un client qui coupe (RST) pendant l'attente de l'upgrade amont", async () => {
    const upstreamSockets: Socket[] = [];
    let upstreamSawRequest: () => void = () => undefined;
    const sawRequest = new Promise<void>((resolve) => {
      upstreamSawRequest = resolve;
    });
    const upstream = createServer();
    // L'amont reçoit l'upgrade mais ne répond jamais : le client part avant.
    upstream.on("upgrade", (_req, socket: Socket) => {
      upstreamSockets.push(socket);
      // Comme un vrai serveur : la fin de flux du pair ferme la socket.
      socket.on("end", () => {
        socket.destroy();
      });
      upstreamSawRequest();
    });
    const upstreamPort = await listen(upstream);
    const proxyPort = await listen(
      createProxy({ backend: { host: "127.0.0.1", port: upstreamPort } }),
    );

    const uncaught: Error[] = [];
    const onUncaught = (error: Error): void => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    try {
      const client = connect(proxyPort, "127.0.0.1");
      client.on("error", () => undefined);
      await new Promise<void>((resolve) => client.once("connect", resolve));
      client.write(
        "GET /ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      await sawRequest;
      client.resetAndDestroy();
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    expect(uncaught).toEqual([]);
    // La requête amont n'est pas retenue : le pair est parti, la socket amont se ferme aussi.
    expect(upstreamSockets.map((socket) => socket.destroyed)).toEqual([true]);
  });
});
