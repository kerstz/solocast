import { config } from "../config";
import { createHttpBackend } from "./http";
import type { ViewerBackend } from "./types";

export type { ViewerBackend } from "./types";
export { ApiError } from "./types";

let instance: ViewerBackend | null = null;

/**
 * Backend singleton. Sans accès navigateur à la construction : sûr au rendu serveur.
 *
 * Le backend mock est chargé par `require()` sous `__MOCK_BACKEND__`, constante injectée au
 * build : en mode `http`, la branche est éliminée et `./mock` ne part PAS dans le bundle
 * de production (pas de clé de démo, pas de données factices côté client).
 */
export function getViewerBackend(): ViewerBackend {
  if (!instance) {
    if (__MOCK_BACKEND__ && config.mode === "mock") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mock = require("./mock") as typeof import("./mock");
      instance = mock.createMockBackend();
    } else {
      instance = createHttpBackend({ apiBaseUrl: config.apiBaseUrl, wsUrl: config.wsUrl });
    }
  }
  return instance;
}
