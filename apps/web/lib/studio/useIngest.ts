"use client";

import type { IngestResponse } from "@solocast/shared";
import { useCallback, useEffect, useState } from "react";
import { pickErrorMessage } from "../backend/errors";
import type { ViewerBackend } from "../backend/types";
import { STRINGS } from "../i18n/strings";

export type IngestPhase = "idle" | "loading" | "ready" | "error";

export interface IngestState {
  phase: IngestPhase;
  ingest: IngestResponse | null;
  error: string | null;
  reload: () => void;
}

/**
 * Ingest OBS du studio : demandé au serveur seulement quand l'onglet OBS est ouvert (`active`),
 * jamais au chargement de la page. L'adresse et la clé de flux ne sont pas mises en cache ailleurs
 * que dans cet état React : rien dans le stockage local, rien dans l'URL.
 */
export function useIngest(backend: ViewerBackend, active: boolean): IngestState {
  const [phase, setPhase] = useState<IngestPhase>("idle");
  const [ingest, setIngest] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!active) return;
    // Drapeau porté par un objet : le cleanup le mute après coup, donc la valeur lue dans la
    // closure asynchrone n'est pas celle de l'initialisation.
    const run = { cancelled: false };
    setPhase("loading");
    setError(null);
    void (async () => {
      try {
        const result = await backend.getIngest();
        if (run.cancelled) return;
        setIngest(result);
        setPhase("ready");
      } catch (err) {
        if (run.cancelled) return;
        setIngest(null);
        setError(pickErrorMessage(STRINGS.studio.obs.errors, err, STRINGS.errors.generic));
        setPhase("error");
      }
    })();
    return () => {
      run.cancelled = true;
    };
  }, [backend, active, attempt]);

  return { phase, ingest, error, reload };
}
