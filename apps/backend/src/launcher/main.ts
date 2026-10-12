import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStatus, ShareState } from "@solocast/shared";
import type { AppControl } from "../app-control.js";
import { buildApp } from "../app.js";
import { createMemoryChatServices } from "../chat/services.js";
import { loadConfig } from "../config.js";
import { MemoryKeyValueStore } from "../state/key-value-store.js";
import { startChild, stopChildren, type Child } from "./children.js";
import {
  clearInstance,
  dataDir,
  loadSettings,
  lockHolder,
  logLine,
  readInstance,
  releaseLock,
  saveSettings,
  tryLock,
  writeInstance,
} from "./data-dir.js";
import { freePort } from "./ports.js";
import { createProxy } from "./proxy.js";

/**
 * Lanceur de l'application installée. Aucune option, aucun fichier de configuration : tout se
 * règle depuis le studio (partage, arrêt). Secrets générés en mémoire à chaque démarrage (tout
 * l'état meurt à l'arrêt de toute façon). Écrit un journal dans le dossier utilisateur car, lancé
 * depuis le menu, il n'a pas de console.
 */

const VERSION = process.env.SOLOCAST_VERSION ?? "dev";
const PREFERRED_PORT = 8080;
const LIVEKIT_PREFERRED_HTTP_PORT = 7880;
const LIVEKIT_TCP_PORT = 7881;
const LIVEKIT_UDP_PORT = 7882;
const TUNNEL_TIMEOUT_MS = 60_000;

const exe = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);

const DATA = dataDir();

function say(message: string): void {
  process.stdout.write(`${message}\n`);
  logLine(DATA, message);
}

/** Sans console, une erreur de démarrage serait invisible : on la montre dans une fenêtre. */
function showError(message: string): void {
  const run = (command: string, args: string[]): boolean => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
      child.on("error", () => undefined);
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
  if (process.platform === "win32") {
    const escaped = message.replace(/'/g, "''");
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${escaped}','SoloCast')`,
    ]);
  } else if (!run("zenity", ["--error", "--title=SoloCast", `--text=${message}`])) {
    run("notify-send", ["SoloCast", message]);
  }
}

function openBrowser(url: string): void {
  if (process.env.SOLOCAST_NO_OPEN === "1") return;
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Pas de navigateur : l'adresse figure dans le journal.
  }
}

function installDir(): string {
  const override = process.env.SOLOCAST_HOME;
  if (override !== undefined && override !== "") return path.resolve(override);
  return path.dirname(fileURLToPath(import.meta.url));
}

async function waitForHttp(url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i += 1) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Chemin de l'exécutable d'un PID, ou null si on ne sait pas le dire. */
function exePathOf(pid: number): string | null {
  try {
    if (process.platform === "linux") return readlinkSync(`/proc/${String(pid)}/exe`);
    if (process.platform === "win32") {
      const out = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue).Path`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 8_000 },
      );
      const value = out.stdout.trim();
      return value === "" ? null : value;
    }
  } catch {
    // Illisible : traité comme « pas à nous ».
  }
  return null;
}

/**
 * Ce PID est-il un programme livré avec SoloCast (node, SFU, tunnel de CE dossier) ? Un PID
 * recyclé par le système après un plantage appartient à un autre programme : on n'y touche pas.
 */
function isOurs(pid: number, home: string): boolean {
  const exe = exePathOf(pid);
  if (exe === null) return false;
  const norm = (value: string): string => path.resolve(value).replaceAll("\\", "/").toLowerCase();
  return norm(exe).startsWith(`${norm(home)}/`);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Un seul SoloCast à la fois. Clic sur l'icône pendant que ça tourne (ou que ça démarre) :
 * on rouvre le studio de l'instance en place. Instance morte : on achève ses orphelins, mais
 * seulement ceux qu'on reconnaît (chemin dans le dossier d'installation).
 */
async function claimInstance(home: string): Promise<"reused" | "free"> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (tryLock(DATA)) {
      const previous = readInstance(DATA);
      if (previous !== null) {
        for (const pid of previous.children) {
          if (isOurs(pid, home)) {
            try {
              process.kill(pid, "SIGTERM");
            } catch {
              // déjà terminé
            }
          }
        }
        clearInstance(DATA);
      }
      return "free";
    }
    const holder = lockHolder(DATA);
    if (holder !== null && holder !== process.pid && alive(holder) && isOurs(holder, home)) {
      // Instance vivante, peut-être encore en démarrage : on attend qu'elle réponde.
      for (let i = 0; i < 60; i += 1) {
        const running = readInstance(DATA);
        if (
          running !== null &&
          (await waitForHttp(`http://127.0.0.1:${String(running.port)}/health`, 1))
        ) {
          openBrowser(`http://localhost:${String(running.port)}/studio`);
          return "reused";
        }
        await sleep(250);
      }
      throw new Error("SoloCast est déjà en cours de démarrage. Réessayez dans un instant.");
    }
    releaseLock(DATA); // verrou périmé (plantage, redémarrage) : on le reprend
  }
  throw new Error("Impossible de prendre le verrou de démarrage.");
}

async function main(): Promise<void> {
  const home = installDir();
  if ((await claimInstance(home)) === "reused") return;

  rmSync(path.join(DATA, "solocast.log"), { force: true });
  // Installé : web/ à côté du script. Depuis le dépôt : apps/web/out (dist/ ou src/launcher/).
  const webDir = [
    path.join(home, "web"),
    path.join(home, "../../web/out"),
    path.join(home, "../../../web/out"),
  ].find((dir) => existsSync(path.join(dir, "index.html")));
  if (webDir === undefined) throw new Error(`Site introuvable (dossier web/ absent de ${home}).`);

  const livekitBin = path.join(home, exe("livekit-server"));
  const cloudflaredBin = path.join(home, exe("cloudflared"));
  const hasLiveKit = existsSync(livekitBin);
  const hasCloudflared = existsSync(cloudflaredBin);
  const settings = loadSettings(DATA);

  const publicPort = await freePort(PREFERRED_PORT);
  const backendPort = await freePort(publicPort + 1);
  // Port HTTP du SFU : libre au moment du démarrage (un autre LiveKit, p. ex. celui de Docker en
  // développement, peut tenir 7880). Seuls 7881/7882 sont fixes : ce sont ceux de la box.
  const livekitPort = await freePort(LIVEKIT_PREFERRED_HTTP_PORT);
  const keys = { key: "solocast", secret: randomBytes(32).toString("hex") };
  const localOrigin = `http://localhost:${String(publicPort)}`;
  const origins = new Set([localOrigin, `http://127.0.0.1:${String(publicPort)}`]);
  const childPids: number[] = [];
  const persistInstance = (): void => {
    writeInstance(DATA, { pid: process.pid, port: publicPort, children: childPids });
  };
  // Les PID terminés sortent de la liste : sinon elle grossit, et un PID recyclé y resterait.
  const remember = (child: Child): void => {
    const pid = child.proc.pid;
    if (pid === undefined) return;
    childPids.push(pid);
    persistInstance();
    child.proc.once("exit", () => {
      const index = childPids.indexOf(pid);
      if (index !== -1) childPids.splice(index, 1);
      if (!stopping) persistInstance();
    });
  };

  // --- Serveur média -----------------------------------------------------------------------
  // `use_external_ip` fait résoudre l'adresse publique par STUN : indispensable à un spectateur
  // distant, mais LiveKit QUITTE s'il n'y a pas d'accès réseau. On essaie donc avec, puis sans.
  // Le studio s'ouvre sans attendre : la vidéo se branche quand le SFU répond.
  const launchLiveKit = (externalIp: boolean): Child => {
    const config = [
      `port: ${String(livekitPort)}`,
      "bind_addresses: [127.0.0.1]",
      "logging: { level: warn, pion_level: error }",
      "rtc:",
      `  tcp_port: ${String(LIVEKIT_TCP_PORT)}`,
      `  udp_port: ${String(LIVEKIT_UDP_PORT)}`,
      `  use_external_ip: ${String(externalIp)}`,
      // 15 spectateurs + le streameur (MAX_VIEWERS=15 côté backend).
      "room: { auto_create: false, empty_timeout: 1800, departure_timeout: 20, max_participants: 16 }",
      "webhook:",
      `  api_key: ${keys.key}`,
      `  urls: [http://127.0.0.1:${String(backendPort)}/webhooks/livekit]`,
    ].join("\n");
    const child = startChild(livekitBin, [], {
      LIVEKIT_KEYS: `${keys.key}: ${keys.secret}`,
      LIVEKIT_CONFIG: config,
    });
    remember(child);
    return child;
  };
  const livekitReady = async (child: Child): Promise<boolean> => {
    const exited = new Promise<false>((resolve) => {
      child.proc.once("exit", () => {
        resolve(false);
      });
    });
    return Promise.race([waitForHttp(`http://127.0.0.1:${String(livekitPort)}`, 30), exited]);
  };
  let videoOk = hasLiveKit;
  const superviseLiveKit = async (): Promise<void> => {
    if (await livekitReady(launchLiveKit(true))) return;
    say("Serveur média : adresse publique introuvable (hors ligne ?), repli réseau local.");
    const retry = launchLiveKit(false);
    if (!(await livekitReady(retry))) {
      videoOk = false;
      say(`Serveur média non démarré : ${retry.tail()}`);
    }
  };

  // --- Partage (tunnel Cloudflare), pilotable depuis le studio ---------------------------------
  let shareState: ShareState = hasCloudflared ? "off" : "unavailable";
  let shareUrl: string | null = null;
  let tunnel: Child | null = null;

  // Chaque tentative a un numéro : le résultat d'une tentative remplacée est ignoré.
  let shareGeneration = 0;
  let cancelPending: (() => void) | null = null;

  const stopShare = (): void => {
    shareGeneration += 1;
    cancelPending?.();
    if (tunnel !== null) {
      const current = tunnel;
      tunnel = null;
      current.proc.removeAllListeners("exit");
      current.proc.kill("SIGTERM");
    }
    if (shareUrl !== null) origins.delete(shareUrl);
    shareUrl = null;
    shareState = hasCloudflared ? "off" : "unavailable";
  };

  const startShare = async (): Promise<void> => {
    if (!hasCloudflared) {
      shareState = "unavailable";
      return;
    }
    if (tunnel !== null) return;
    shareState = "starting";
    shareGeneration += 1;
    const generation = shareGeneration;
    // Config vide : un ~/.cloudflared/config.yml existant ferait refuser le tunnel rapide.
    const emptyConfig = path.join(DATA, "cloudflared.yml");
    writeFileSync(emptyConfig, "");
    const found = await new Promise<string | null>((resolve) => {
      cancelPending = () => {
        resolve(null);
      };
      const timer = setTimeout(() => {
        resolve(null);
      }, TUNNEL_TIMEOUT_MS);
      const child = startChild(
        cloudflaredBin,
        [
          "tunnel",
          "--no-autoupdate",
          "--config",
          emptyConfig,
          "--url",
          `http://127.0.0.1:${String(publicPort)}`,
        ],
        {},
        (line) => {
          const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(line);
          if (match !== null) {
            clearTimeout(timer);
            resolve(match[0]);
          }
        },
      );
      tunnel = child;
      remember(child);
      child.proc.once("exit", () => {
        clearTimeout(timer);
        resolve(null);
        if (tunnel === child) {
          // Coupure inattendue : on le dit au studio au lieu d'afficher une adresse morte.
          tunnel = null;
          if (shareUrl !== null) origins.delete(shareUrl);
          shareUrl = null;
          shareState = "unavailable";
        }
      });
    });
    cancelPending = null;
    // Remplacée entre-temps (coupée ou relancée) : l'état appartient à la tentative en cours.
    if (generation !== shareGeneration) return;
    if (found === null) {
      stopShare();
      shareState = "unavailable";
      return;
    }
    shareUrl = found;
    origins.add(found);
    shareState = "on";
  };

  // --- Arrêt -----------------------------------------------------------------------------------
  let stopping = false;
  let appRef: Awaited<ReturnType<typeof buildApp>> | null = null;
  const proxy = createProxy({
    backend: { host: "127.0.0.1", port: backendPort },
    ...(hasLiveKit ? { livekit: { host: "127.0.0.1", port: livekitPort } } : {}),
  });
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    say("Arrêt de SoloCast.");
    stopChildren();
    clearInstance(DATA);
    releaseLock(DATA);
    proxy.close();
    void (appRef?.close() ?? Promise.resolve()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };

  const control: AppControl = {
    status: (): AppStatus => ({
      version: VERSION,
      share: { state: shareState, url: shareState === "on" ? shareUrl : null },
      video: videoOk,
      ingest: false,
      mediaPorts: { tcp: LIVEKIT_TCP_PORT, udp: LIVEKIT_UDP_PORT },
    }),
    setShare: async (enabled) => {
      saveSettings(DATA, { share: enabled });
      if (enabled) await startShare();
      else stopShare();
    },
    quit: shutdown,
  };

  // --- Backend + proxy -------------------------------------------------------------------------
  const config = loadConfig({
    NODE_ENV: "production",
    LOG_LEVEL: "warn",
    BACKEND_HOST: "127.0.0.1",
    BACKEND_PORT: String(backendPort),
    STATE_BACKEND: "memory",
    JWT_SECRET: randomBytes(32).toString("hex"),
    CORS_ORIGIN: [...origins].join(","),
    COOKIE_SECURE: "true",
    SESSION_COOKIE_NAME: "sc_session",
    VIEWER_COOKIE_NAME: "sc_viewer",
    LIVEKIT_URL: `http://127.0.0.1:${String(livekitPort)}`,
    LIVEKIT_PUBLIC_WS_URL: "/",
    LIVEKIT_API_KEY: keys.key,
    LIVEKIT_API_SECRET: keys.secret,
    ROOM_NAME: "main",
    MAX_VIEWERS: "15",
  });
  const app = await buildApp({
    config,
    store: new MemoryKeyValueStore(),
    chat: createMemoryChatServices({ historySize: config.CHAT_HISTORY_SIZE }),
    staticDir: webDir,
    studioLocalOnly: true,
    appControl: control,
    origins,
    trustCloudflareIp: true,
  });
  appRef = app;
  await app.listen({ host: "127.0.0.1", port: backendPort });
  await new Promise<void>((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(publicPort, "127.0.0.1", resolve);
  });
  writeInstance(DATA, { pid: process.pid, port: publicPort, children: childPids });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);
  process.on("exit", stopChildren);

  if (hasLiveKit) void superviseLiveKit();
  // Sans attendre : hors ligne, l'ouverture du tunnel peut durer jusqu'à son délai (60 s).
  if (settings.share) void startShare();

  const publicUrl = control.status().share.url;
  say(
    `SoloCast ${VERSION} prêt : ${localOrigin}/studio${publicUrl === null ? "" : ` — public : ${publicUrl}`}`,
  );
  openBrowser(`${localOrigin}/studio`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logLine(DATA, `Échec du démarrage : ${message}`);
  process.stderr.write(`SoloCast n'a pas pu démarrer : ${message}\n`);
  showError(
    `SoloCast n'a pas pu démarrer.\n\n${message}\n\nJournal : ${path.join(DATA, "solocast.log")}`,
  );
  stopChildren();
  process.exitCode = 1;
});
