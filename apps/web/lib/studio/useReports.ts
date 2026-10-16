"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Report } from "@solocast/shared";
import type { ViewerBackend } from "../backend/types";

export const REPORTS_REFRESH_MS = 15_000;

export interface ReportsController {
  reports: readonly Report[];
  /** true quand le dernier rafraîchissement ou la dernière action a échoué. */
  failed: boolean;
  dismiss: (id: string) => void;
}

/** Liste des signalements du studio : relue périodiquement, retirée par « Dismiss ». */
export function useReports(backend: ViewerBackend): ReportsController {
  const [reports, setReports] = useState<readonly Report[]>([]);
  const [failed, setFailed] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await backend.listReports();
      if (aliveRef.current) {
        setReports(next);
        setFailed(false);
      }
    } catch {
      if (aliveRef.current) setFailed(true);
    }
  }, [backend]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, REPORTS_REFRESH_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  const dismiss = useCallback(
    (id: string) => {
      backend
        .dismissReport(id)
        .then(() => {
          if (aliveRef.current) {
            setReports((prev) => prev.filter((report) => report.id !== id));
            setFailed(false);
          }
        })
        .catch(() => {
          if (aliveRef.current) setFailed(true);
          // Un 404 = déjà retiré ailleurs : on resynchronise.
          void refresh();
        });
    },
    [backend, refresh],
  );

  return { reports, failed, dismiss };
}
