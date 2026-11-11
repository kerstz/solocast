// Arrêt propre : ferme l'app puis les ressources, une seule fois, avec un délai maximal. Une
// fermeture qui échoue ou qui n'aboutit pas ne doit ni rester en promesse rejetée non rattrapée
// ni laisser le processus (et ses sockets) en vie : le conteneur finirait tué par SIGKILL.
export interface ShutdownDeps {
  close: () => Promise<void>;
  exit: (code: number) => void;
  log: (message: string) => void;
  timeoutMs?: number;
}

export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let started = false;
  return async (signal) => {
    if (started) return;
    started = true;
    deps.log(`Shutdown requested (${signal})`);
    const timer = setTimeout(() => {
      deps.log("Shutdown timed out, forcing exit");
      deps.exit(1);
    }, deps.timeoutMs ?? 10_000);
    timer.unref();
    try {
      await deps.close();
      clearTimeout(timer);
      deps.exit(0);
    } catch (error) {
      clearTimeout(timer);
      deps.log(`Shutdown failed: ${error instanceof Error ? error.name : "UnknownError"}`);
      deps.exit(1);
    }
  };
}
