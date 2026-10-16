import { ApiError, type ViewerBackend } from "../backend/types";

export type OpenStudioResult = "open" | "key_required";

/**
 * Ouvre le studio. Sans clé d'abord ; si le serveur répond « studio_key_required », renvoie
 * "key_required" pour que l'UI demande la clé. La clé n'est que transmise : jamais stockée.
 * Autre erreur : relancée telle quelle.
 */
export async function openStudioWith(
  backend: Pick<ViewerBackend, "getMe" | "openStudio">,
  key?: string,
): Promise<OpenStudioResult> {
  try {
    if (key === undefined) {
      const me = await backend.getMe();
      if (me?.role === "streamer") return "open";
      await backend.openStudio();
    } else {
      await backend.openStudio(key);
    }
    return "open";
  } catch (err) {
    if (err instanceof ApiError && err.code === "studio_key_required") return "key_required";
    throw err;
  }
}
