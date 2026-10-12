import { MAX_SPEAKERS } from "@solocast/shared";

/** Intervalle de rafraîchissement des compteurs du studio (cadence des presence:update mock). */
export const COUNTERS_REFRESH_MS = 5000;

/** Jauge « x/8 » : nombre de speakers WebRTC actifs sur le plafond serveur. */
export function formatSpeakers(count: number | null, max: number = MAX_SPEAKERS): string {
  const shown = count === null ? "—" : String(Math.max(0, Math.trunc(count)));
  return `${shown}/${String(max)}`;
}

/** Vrai si le plafond de speakers est atteint : le bouton Donner est alors désactivé (UI seulement). */
export function isSpeakerCapReached(count: number | null, max: number = MAX_SPEAKERS): boolean {
  return count !== null && count >= max;
}

/** Secondes écoulées depuis la dernière présence reçue (null si jamais reçue). Jamais négatif. */
export function presenceAgeSeconds(now: number, presenceAt: number | null): number | null {
  if (presenceAt === null) return null;
  return Math.max(0, Math.floor((now - presenceAt) / 1000));
}
