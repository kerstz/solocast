import type { AppStatus } from "@solocast/shared";

/**
 * Commandes de l'application installée, pilotées depuis le site (studio) : plus rien à faire
 * dans un terminal. Fourni par le lanceur ; absent en développement (`pnpm dev`).
 */
export interface AppControl {
  status: () => AppStatus;
  /** Active ou coupe l'adresse publique. Résout quand l'état est stable (on / unavailable / off). */
  setShare: (enabled: boolean) => Promise<void>;
  /** Arrête SoloCast (réponse HTTP envoyée avant la coupure). */
  quit: () => void;
}
