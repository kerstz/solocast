/**
 * Le backend peut renvoyer `livekitUrl` sous forme de chemin (`/`) : le SFU est alors derrière la
 * même origine que la page. On le résout ici contre l'adresse courante pour obtenir ws(s)://hôte.
 */
export function resolveLivekitUrl(
  url: string,
  location: Pick<Location, "protocol" | "host"> = window.location,
): string {
  if (!url.startsWith("/")) return url;
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${url}`;
}
