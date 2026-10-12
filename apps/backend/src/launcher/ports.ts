import { createServer } from "node:net";

/** Premier port libre à partir de `preferred` (127.0.0.1), puis un port éphémère en dernier recours. */
export async function freePort(preferred: number): Promise<number> {
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
    const found = await tryListen(preferred + offset);
    if (found !== null) return found;
  }
  const ephemeral = await tryListen(0);
  if (ephemeral === null) throw new Error("No free TCP port available");
  return ephemeral;
}
