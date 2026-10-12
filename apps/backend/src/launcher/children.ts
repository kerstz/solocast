import { spawn, type ChildProcess } from "node:child_process";

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
  const feed = (chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line === "") continue;
      lines.push(line);
      if (lines.length > 15) lines.shift();
      onLine?.(line);
    }
  };
  proc.stdout.on("data", feed);
  proc.stderr.on("data", feed);
  return { proc, tail: () => lines.join("\n") };
}

export function stopChildren(): void {
  for (const proc of children) {
    if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
  }
}
