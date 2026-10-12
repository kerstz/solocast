import { createServer } from "node:net";

/**
 * Premier port libre à partir de `preferred` (127.0.0.1), en évitant `skip` (ports qu'un autre
 * composant utilise : p. ex. 7881/7882, fixes pour le SFU), puis un port éphémère en dernier recours.
 */
export async function freePort(preferred: number, skip: readonly number[] = []): Promise<number> {
  const tryListen = (port: number): Promise<number | null> =>
    new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => {
        resolve(null);
      });
      probe.listen(port, "127.0.0.1", () => {
        const address = probe.address();
        const bound = typeof address === "object" && address !== null ? address.port : null;
        probe.close(() => {
          resolve(bound);
        });
      });
    });

  for (let offset = 0; offset < 20; offset += 1) {
    const candidate = preferred + offset;
    if (skip.includes(candidate)) continue;
    const found = await tryListen(candidate);
    if (found !== null) return found;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ephemeral = await tryListen(0);
    if (ephemeral !== null && !skip.includes(ephemeral)) return ephemeral;
  }
  throw new Error("No free TCP port available");
}
