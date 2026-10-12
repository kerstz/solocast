import { ApiError } from "./types";

/** Choisit le message i18n correspondant au code d'erreur API, sinon le repli. */
export function pickErrorMessage(
  table: Readonly<Record<string, string>>,
  err: unknown,
  fallback: string,
): string {
  if (err instanceof ApiError && Object.prototype.hasOwnProperty.call(table, err.code)) {
    return table[err.code] ?? fallback;
  }
  return fallback;
}
