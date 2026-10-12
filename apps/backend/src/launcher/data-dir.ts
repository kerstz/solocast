import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const folderName = process.platform === "win32" ? "SoloCast" : "solocast";

function ensure(dir: string): string {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Dossier non créable : les écritures échouent ensuite sans bruit, l'app tourne quand même.
  }
  return dir;
}

/** Réglages de l'utilisateur : %APPDATA%\SoloCast (Windows) ou ~/.config/solocast. */
export function dataDir(): string {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"));
  return ensure(path.join(base, folderName));
}

/**
 * État de session (verrou, instance, journal) : propre à la machine, donc %LOCALAPPDATA% sous
 * Windows (hors profil itinérant). Même dossier que les réglages ailleurs.
 */
export function stateDir(): string {
  if (process.platform !== "win32") return dataDir();
  const base = process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local");
  // Nom distinct du dossier d'installation (l'ancien emplacement par défaut était
  // %LOCALAPPDATA%\SoloCast) : le désinstalleur peut ainsi retirer le programme proprement.
  return ensure(path.join(base, `${folderName}-state`));
}

// Antivirus et indexeurs verrouillent parfois un fichier une fraction de seconde (EBUSY/EPERM) :
// aucune de ces opérations ne doit faire tomber l'application.
function attempt(action: () => void): void {
  try {
    action();
  } catch {
    // ignoré : voir ci-dessus
  }
}

export interface Settings {
  // Publier l'adresse partageable au démarrage. Réglé depuis le studio, pas depuis un terminal.
  share: boolean;
}

export function loadSettings(dir: string): Settings {
  try {
    const raw = JSON.parse(
      readFileSync(path.join(dir, "settings.json"), "utf8"),
    ) as Partial<Settings>;
    return { share: raw.share === true };
  } catch {
    return { share: false };
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  attempt(() => {
    writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  });
}

export interface InstanceInfo {
  pid: number;
  port: number;
  /** Identifiant aléatoire repris par /health : prouve que ce port est bien CETTE instance. */
  id: string;
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
      id: typeof raw.id === "string" ? raw.id : "",
      children: Array.isArray(raw.children)
        ? raw.children.filter((n): n is number => typeof n === "number")
        : [],
    };
  } catch {
    return null;
  }
}

export function writeInstance(dir: string, info: InstanceInfo): void {
  attempt(() => {
    writeFileSync(instanceFile(dir), JSON.stringify(info));
  });
}

export function clearInstance(dir: string): void {
  attempt(() => {
    rmSync(instanceFile(dir), { force: true, maxRetries: 5, retryDelay: 100 });
  });
}

export function logLine(dir: string, line: string): void {
  attempt(() => {
    appendFileSync(path.join(dir, "solocast.log"), `${new Date().toISOString()} ${line}\n`);
  });
}

const lockFile = (dir: string): string => path.join(dir, "instance.lock");

/** Verrou exclusif de démarrage : le premier lancement le prend, un second ne démarre pas. */
export function tryLock(dir: string): boolean {
  try {
    const fd = openSync(lockFile(dir), "wx");
    try {
      writeFileSync(fd, String(process.pid));
    } finally {
      closeSync(fd);
    }
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

/** Âge du fichier verrou (ms), null s'il n'existe pas. Un verrou tout neuf n'a pas encore son PID. */
export function lockAgeMs(dir: string): number | null {
  try {
    return Date.now() - statSync(lockFile(dir)).mtimeMs;
  } catch {
    return null;
  }
}

export function releaseLock(dir: string): void {
  attempt(() => {
    rmSync(lockFile(dir), { force: true, maxRetries: 5, retryDelay: 100 });
  });
}
