#!/usr/bin/env node
/**
 * Test de fumée de l'application INSTALLÉE (utilisé par la CI sous Windows et Debian).
 * Il ne démarre rien : l'app tourne déjà (lancée comme le fait le raccourci du menu).
 *
 *   node smoke.mjs core  [--video]   site, API, verrous, WebSocket via le proxy, SFU
 *   node smoke.mjs share             ouvre le lien public, vérifie qu'il ne donne pas le studio
 *   node smoke.mjs quit              arrête l'app depuis l'API et attend sa disparition
 *
 * Option : --port N (défaut 8080). Sans dépendance : Node seul, même script sur les deux OS.
 */
import { request } from "node:http";

const args = process.argv.slice(2);
const stage = args[0];
const wantVideo = args.includes("--video");
const portIndex = args.indexOf("--port");
const PORT = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const HOST = "127.0.0.1";
const ORIGIN = `http://${HOST}:${String(PORT)}`;

let failures = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const fail = (name, detail) => {
  failures += 1;
  console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${detail}`}`);
};
const check = (name, condition, detail) => (condition ? ok(name) : fail(name, detail));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Requête HTTP brute : `fetch` ne laisse pas forcer Host/Origin comme on veut. */
function http(
  method,
  path,
  { headers = {}, body, host = HOST, port = PORT, timeout = 15_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host,
        port,
        method,
        path,
        headers: {
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
          ...headers,
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function waitHealthy(seconds) {
  for (let i = 0; i < seconds * 2; i += 1) {
    try {
      const res = await http("GET", "/health", { timeout: 2_000 });
      if (res.status === 200) return true;
    } catch {
      // pas encore prêt
    }
    await sleep(500);
  }
  return false;
}

// Le cookie du studio porte le préfixe __Host- dans l'app installée.
const STUDIO_COOKIE = /^(__Host-)?sc_session=/;

function cookieOf(res) {
  const raw = res.headers["set-cookie"] ?? [];
  for (const line of raw) {
    if (STUDIO_COOKIE.test(line)) return line.split(";")[0];
  }
  return null;
}

async function openStudio() {
  const res = await http("POST", "/api/studio/open", { body: {} });
  const cookie = cookieOf(res);
  if (res.status !== 204 || cookie === null) {
    throw new Error(`studio/open : HTTP ${String(res.status)}, cookie ${String(cookie)}`);
  }
  return cookie;
}

/** Mise à niveau WebSocket écrite à la main (pas de dépendance) : lit les premières trames. */
function websocket(path, headers, listenMs) {
  return new Promise((resolve) => {
    const out = { status: 0, text: "", closedEarly: false };
    const req = request({
      host: HOST,
      port: PORT,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from("solocast-smoke-1").toString("base64"),
        ...headers,
      },
    });
    req.on("upgrade", (res, socket, head) => {
      out.status = res.statusCode ?? 101;
      // Les premières trames arrivent souvent collées au 101 : elles sont dans `head`.
      if (head.length > 0) {
        out.text += head.toString("latin1");
        if (head[0] === 0x88) out.closedEarly = true;
      }
      socket.on("data", (d) => {
        out.text += d.toString("latin1");
        // 0x88 en tête d'une trame = Close : le serveur (ou le proxy) a coupé.
        if (d.length > 0 && d[0] === 0x88) out.closedEarly = true;
      });
      socket.on("close", () => {
        out.closedEarly = true;
      });
      setTimeout(() => {
        socket.destroy();
        resolve(out);
      }, listenMs);
    });
    req.on("response", (res) => {
      out.status = res.statusCode ?? 0;
      resolve(out);
    });
    req.on("error", () => resolve(out));
    req.end();
  });
}

async function core() {
  console.log("core");
  check("health", await waitHealthy(90), "l'app ne répond pas sur /health");

  for (const [path, needle] of [
    ["/", "SoloCast"],
    ["/studio/", ""],
    ["/watch/", ""],
  ]) {
    const res = await http("GET", path);
    check(
      `GET ${path}`,
      res.status === 200 && res.text.includes(needle),
      `HTTP ${String(res.status)}`,
    );
  }
  const home = await http("GET", "/");
  check(
    "CSP présente",
    String(home.headers["content-security-policy"] ?? "").includes("default-src 'self'"),
  );
  const missing = await http("GET", "/pas-une-page");
  check("404 pour une page inconnue", missing.status === 404, `HTTP ${String(missing.status)}`);
  const traversal = await http("GET", "/..%2f..%2fetc%2fpasswd");
  check("pas de traversée de chemin", traversal.status !== 200, `HTTP ${String(traversal.status)}`);

  const cookie = await openStudio();
  ok("studio/open depuis cette machine (204 + cookie)");

  const status = await http("GET", "/api/app/status", { headers: { cookie } });
  let parsed = null;
  try {
    parsed = JSON.parse(status.text);
  } catch {
    // vérifié ci-dessous
  }
  check("api/app/status", status.status === 200 && parsed?.mediaPorts?.tcp === 7881, status.text);
  check("partage éteint par défaut", parsed?.share?.state === "off", status.text);
  if (wantVideo) {
    // Le SFU démarre en arrière-plan (jusqu'à ~1 min hors ligne, repli sans STUN) : on l'attend.
    let video = parsed?.video;
    for (let i = 0; i < 120 && video === "starting"; i += 1) {
      await sleep(1_000);
      const again = await http("GET", "/api/app/status", { headers: { cookie } });
      video = JSON.parse(again.text).video;
    }
    check("serveur vidéo prêt", video === "ready", `video=${String(video)}`);
  }

  const anonStatus = await http("GET", "/api/app/status");
  check(
    "api/app/status refusé sans cookie studio",
    anonStatus.status === 403,
    `HTTP ${String(anonStatus.status)}`,
  );

  const evil = await http("POST", "/api/studio/open", {
    body: {},
    headers: { origin: "https://evil.example" },
  });
  check("CSRF : origine étrangère refusée", evil.status === 403, `HTTP ${String(evil.status)}`);

  const remote = await http("POST", "/api/studio/open", {
    body: {},
    headers: { host: "random-words.trycloudflare.com" },
  });
  check(
    "studio refusé via une adresse publique",
    remote.status === 403,
    `HTTP ${String(remote.status)}`,
  );

  const remoteApp = await http("GET", "/api/app/status", {
    headers: { cookie, host: "random-words.trycloudflare.com" },
  });
  check(
    "api/app refusé via une adresse publique",
    remoteApp.status === 403,
    `HTTP ${String(remoteApp.status)}`,
  );

  for (const p of ["/webhooks/livekit", "/%77ebhooks/livekit", "/WebHooks/livekit"]) {
    const res = await http("POST", p, { body: {} });
    check(`webhook non exposé (${p})`, res.status === 404, `HTTP ${String(res.status)}`);
  }

  const ws = await websocket("/ws", { origin: ORIGIN, cookie }, 4_000);
  check("WebSocket chat : 101 via le proxy", ws.status === 101, `HTTP ${String(ws.status)}`);
  check(
    "WebSocket : historique et présence reçus",
    ws.text.includes("chat:history") && ws.text.includes("presence:update"),
    ws.text.slice(0, 120),
  );
  check("WebSocket : reste ouvert", !ws.closedEarly, "fermé par le proxy ou le serveur");
  const wsBad = await websocket("/ws", { origin: "https://evil.example", cookie }, 1_000);
  check(
    "WebSocket : origine étrangère refusée",
    wsBad.status === 403,
    `HTTP ${String(wsBad.status)}`,
  );

  const tokenRes = await http("POST", "/api/token", { body: {}, headers: { cookie } });
  let token = null;
  try {
    token = JSON.parse(tokenRes.text);
  } catch {
    // vérifié ci-dessous
  }
  check(
    "api/token : jeton LiveKit, URL même origine",
    tokenRes.status === 200 && token?.livekitUrl === "/",
    tokenRes.text.slice(0, 160),
  );

  if (wantVideo) {
    const rtc = await http("GET", "/rtc/validate");
    check(
      "SFU joignable via /rtc (401 = il tourne)",
      rtc.status === 401,
      `HTTP ${String(rtc.status)}`,
    );
  }
}

async function share() {
  console.log("share");
  check("health", await waitHealthy(30));
  const cookie = await openStudio();
  const on = await http("POST", "/api/app/share", {
    body: { enabled: true },
    headers: { cookie },
    timeout: 120_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(on.text);
  } catch {
    // vérifié ci-dessous
  }
  check("tunnel ouvert", on.status === 200 && parsed?.share?.state === "on", on.text);
  const url = parsed?.share?.url;
  check(
    "adresse publique trycloudflare",
    typeof url === "string" && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url),
    String(url),
  );
  if (typeof url === "string") {
    let publicHome = null;
    let lastError = "";
    for (let i = 0; i < 30 && publicHome === null; i += 1) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (res.status === 200) publicHome = res;
        else lastError = `HTTP ${String(res.status)}`;
      } catch (error) {
        // le DNS du tunnel met parfois quelques secondes
        const cause = error instanceof Error ? error.cause : undefined;
        lastError = `${String(error)}${cause === undefined ? "" : ` (${String(cause)})`}`;
      }
      if (publicHome === null) await sleep(2_000);
    }
    check("la page est servie par l'adresse publique", publicHome !== null, lastError);
    try {
      const res = await fetch(`${url}/api/studio/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(15_000),
      });
      check("studio refusé depuis internet", res.status === 403, `HTTP ${String(res.status)}`);
    } catch (error) {
      fail("studio refusé depuis internet", String(error));
    }
  }
  const off = await http("POST", "/api/app/share", {
    body: { enabled: false },
    headers: { cookie },
  });
  check("tunnel fermé", off.status === 200 && JSON.parse(off.text).share.state === "off", off.text);
}

async function quit() {
  console.log("quit");
  const cookie = await openStudio();
  const res = await http("POST", "/api/app/quit", { body: {}, headers: { cookie } });
  check("api/app/quit (204)", res.status === 204, `HTTP ${String(res.status)}`);
  let down = false;
  for (let i = 0; i < 40 && !down; i += 1) {
    try {
      await http("GET", "/health", { timeout: 1_000 });
      await sleep(500);
    } catch {
      down = true;
    }
  }
  check("l'app s'arrête", down, "toujours joignable après 20 s");
}

try {
  if (stage === "core") await core();
  else if (stage === "share") await share();
  else if (stage === "quit") await quit();
  else {
    console.error("usage: node smoke.mjs core|share|quit [--video] [--port N]");
    process.exit(2);
  }
} catch (error) {
  fail("exception", error instanceof Error ? error.message : String(error));
}
console.log(failures === 0 ? "RESULT: PASS" : `RESULT: ${String(failures)} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
