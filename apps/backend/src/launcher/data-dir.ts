import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Dossier utilisateur de l'app : %APPDATA%\SoloCast (Windows) ou ~/.config/solocast. */
export function dataDir(): string {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"));
  const dir = path.join(base, process.platform === "win32" ? "SoloCast" : "solocast");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface Settings {
  // Publier l'adresse partageable au démarrage. Réglé depuis le studio, pas depuis un terminal.
  share: boolean;
}

const DEFAULT_SETTINGS: Settings = { share: false };

export function loadSettings(dir: string): Settings {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(dir, "settings.json"), "utf8"),
    ) as Partial<Settings>;
    return { share: raw.share === true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

export interface InstanceInfo {
  pid: number;
  port: number;
  children: number[];
}

const instanceFile = (dir: string): string => path.join(dir, "instance.json");

export function readInstance(dir: string): InstanceInfo | null {
  try {
    const raw = JSON.parse(readFileSync(instanceFile(dir), "utf8")) as Partial<InstanceInfo>;
    if (typeof raw.pid !== "number" || typeof raw.port !== "number") return null;
    return {
      pid: raw.pid,
      port: raw.port,
      children: Array.isArray(raw.children)
        ? raw.children.filter((n) => typeof n === "number")
        : [],
    };
  } catch {
    return null;
  }
}

export function writeInstance(dir: string, info: InstanceInfo): void {
  writeFileSync(instanceFile(dir), JSON.stringify(info));
}

export function clearInstance(dir: string): void {
  rmSync(instanceFile(dir), { force: true });
}

export function logLine(dir: string, line: string): void {
  try {
    appendFileSync(path.join(dir, "solocast.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Journal indisponible : sans conséquence pour le fonctionnement.
  }
}

const lockFile = (dir: string): string => path.join(dir, "instance.lock");

/** Verrou exclusif de démarrage : le premier lancement le prend, un second ne démarre pas. */
export function tryLock(dir: string): boolean {
  try {
    const fd = openSync(lockFile(dir), "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function lockHolder(dir: string): number | null {
  try {
    const pid = Number(readFileSync(lockFile(dir), "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function releaseLock(dir: string): void {
  rmSync(lockFile(dir), { force: true });
}
