"use client";

import type { AppStatus } from "@solocast/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { pickErrorMessage } from "../backend/errors";
import type { ViewerBackend } from "../backend/types";
import { STRINGS } from "../i18n/strings";

export interface AppControlState {
  /** `null` : pas l'application installée (ou pas encore chargé) : le panneau reste caché. */
  status: AppStatus | null;
  busy: boolean;
  error: string | null;
  stopped: boolean;
  toggleShare: () => void;
  quit: () => void;
}

const STATUS_POLL_MS = 3_000;

/**
 * État de l'application installée, piloté depuis le studio : partage public, arrêt. Le serveur
 * reste l'autorité : l'interface n'affiche que ce qu'il renvoie (adresse, état du tunnel).
 */
export function useAppControl(backend: ViewerBackend): AppControlState {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const run = { cancelled: false };
    const load = async (): Promise<void> => {
      try {
        const next = await backend.getAppStatus();
        if (!run.cancelled) setStatus(next);
      } catch {
        // Injoignable : on garde le dernier état connu, le prochain tour réessaie.
      }
    };
    void load();
    const id = setInterval(() => {
      if (!stopped) void load();
    }, STATUS_POLL_MS);
    return () => {
      run.cancelled = true;
      clearInterval(id);
    };
  }, [backend, stopped]);

  const toggleShare = useCallback(() => {
    const current = statusRef.current;
    if (current === null || busy) return;
    const enable = current.share.state !== "on";
    setBusy(true);
    setError(null);
    // Ouvrir un tunnel prend quelques secondes : on l'affiche tout de suite comme « en cours ».
    if (enable) setStatus({ ...current, share: { state: "starting", url: null } });
    void backend
      .setShare(enable)
      .then(setStatus)
      .catch((err: unknown) => {
        setStatus(current);
        setError(pickErrorMessage(STRINGS.studio.app.errors, err, STRINGS.errors.generic));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [backend, busy]);

  const quit = useCallback(() => {
    setBusy(true);
    setError(null);
    void backend
      .quitApp()
      .then(() => {
        setStopped(true);
      })
      .catch((err: unknown) => {
        setError(pickErrorMessage(STRINGS.studio.app.errors, err, STRINGS.errors.generic));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [backend]);

  return { status, busy, error, stopped, toggleShare, quit };
}
