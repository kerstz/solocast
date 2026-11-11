// Arrêt propre : ferme l'app puis les ressources, une seule fois, avec un délai maximal ; un second signal force la sortie. Une
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
    // Second signal (Ctrl+C répété, docker stop puis kill) : on ne rattend pas, on sort.
    if (started) {
      deps.log(`Second signal (${signal}), forcing exit`);
      deps.exit(1);
      return;
    }
    started = true;
    deps.log(`Shutdown requested (${signal})`);
    const timer = setTimeout(() => {
      deps.log("Shutdown timed out, forcing exit");
      deps.exit(1);
    }, deps.timeoutMs ?? 10_000);
    // Pas de unref : le délai doit tenir le processus en vie tant que la fermeture pend.
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
