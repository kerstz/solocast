"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeResponse, ViewerColor } from "@solocast/shared";
import { getViewerBackend } from "../backend";

export interface SessionValue {
  status: "loading" | "ready" | "error";
  me: MeResponse | null;
  /** Le viewer a-t-il choisi un pseudo ? Condition d'accès au chat. */
  hasPseudo: boolean;
  setPseudo: (pseudo: string, color: ViewerColor) => Promise<MeResponse>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Session côté client : lit GET /api/me. Aucun token ni rôle n'est stocké dans le navigateur. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const backend = getViewerBackend();

  const refresh = useCallback(async () => {
    try {
      setMe(await backend.getMe());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [backend]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPseudo = useCallback(
    async (pseudo: string, color: ViewerColor): Promise<MeResponse> => {
      const updated = await backend.setPseudo({ pseudo, color });
      setMe(updated);
      setStatus("ready");
      return updated;
    },
    [backend],
  );

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      hasPseudo: Boolean(me?.pseudo),
      setPseudo,
      refresh,
    }),
    [status, me, setPseudo, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession doit être utilisé dans SessionProvider");
  return value;
}
