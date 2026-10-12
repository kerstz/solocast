import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

export interface Child {
  proc: ChildProcess;
  // Dernières lignes de sortie : affichées si le processus meurt au démarrage.
  tail: () => string;
}

const children: ChildProcess[] = [];

export function startChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  onLine?: (line: string) => void,
): Child {
  const proc = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(proc);

  const lines: string[] = [];
  const push = (line: string): void => {
    if (line === "") return;
    lines.push(line);
    if (lines.length > 15) lines.shift();
    onLine?.(line);
  };
  // Un bloc peut couper une ligne en deux (l'adresse du tunnel, p. ex.) : on garde le reste
  // incomplet et on le recolle au bloc suivant.
  const follow = (stream: Readable): void => {
    let partial = "";
    stream.on("data", (chunk: Buffer) => {
      const parts = (partial + chunk.toString("utf8")).split(/\r?\n/);
      partial = parts.pop() ?? "";
      for (const part of parts) push(part);
    });
    stream.on("end", () => {
      push(partial);
      partial = "";
    });
  };
  follow(proc.stdout);
  follow(proc.stderr);
  proc.on("error", () => undefined);
  return { proc, tail: () => lines.join("\n") };
}

export function stopChildren(): void {
  for (const proc of children) {
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
  }
}
