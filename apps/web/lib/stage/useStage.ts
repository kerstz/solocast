"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenResponse } from "@solocast/shared";
import type { ViewerBackend } from "../backend/types";
import type { ChatClient } from "../chat/chatClient";
import { StageMediaError, type StageMedia } from "./media";
import {
  canRequest,
  INITIAL_STAGE_STATE,
  isActive,
  stageReducer,
  type StageEvent,
  type StageState,
} from "./stageMachine";

export interface StageController {
  state: StageState;
  /** Envoie stage:request. Retourne false si impossible (chat déconnecté, phase non autorisée). */
  request: () => boolean;
  /** Quitte l'antenne côté viewer : coupe le micro et la session SFU. */
  leave: () => void;
  dismiss: () => void;
}

/**
 * Orchestration de la parole. La demande ne donne aucun droit : seul stage:granted
 * (serveur) déclenche POST /api/token, puis la connexion SFU audio seul.
 * `attemptRef` invalide les opérations asynchrones dépassées (révocation pendant un mint).
 */
export function useStage(
  chat: ChatClient,
  backend: ViewerBackend,
  media: StageMedia,
): StageController {
  const [state, setState] = useState<StageState>(INITIAL_STAGE_STATE);
  const stateRef = useRef<StageState>(INITIAL_STAGE_STATE);
  const attemptRef = useRef(0);

  const dispatch = useCallback((event: StageEvent): StageState => {
    const next = stageReducer(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);

  const runGrant = useCallback(async (): Promise<void> => {
    if (stageReducer(stateRef.current, { type: "GRANTED" }).phase !== "minting") return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    const isCurrent = (): boolean => attempt === attemptRef.current;
    dispatch({ type: "GRANTED" });

    let token: TokenResponse;
    try {
      token = await backend.mintToken();
    } catch {
      if (isCurrent()) dispatch({ type: "TOKEN_FAILED" });
      return;
    }
    if (!isCurrent()) return;

    const afterToken = dispatch({ type: "TOKEN_OK", token });
    if (afterToken.phase !== "connecting") return;

    try {
      await media.connect(token, {
        onDisconnected: () => {
          if (isCurrent()) dispatch({ type: "DISCONNECTED" });
        },
      });
      if (!isCurrent()) {
        await media.disconnect();
        return;
      }
      dispatch({ type: "CONNECTED" });

      await media.enableMicrophone();
      if (!isCurrent()) {
        await media.disconnect();
        return;
      }
      dispatch({ type: "MIC_ON" });
    } catch (err) {
      if (!isCurrent()) return;
      const reason =
        err instanceof StageMediaError && err.code === "mic_denied" ? "mic_denied" : "media_failed";
      dispatch({ type: "MEDIA_FAILED", reason });
      await media.disconnect().catch(() => undefined);
    }
  }, [backend, media, dispatch]);

  const endSession = useCallback(
    async (event: "REVOKED"): Promise<void> => {
      attemptRef.current += 1;
      const before = stateRef.current;
      dispatch({ type: event });
      if (isActive(before)) {
        await media.disconnect().catch(() => undefined);
      }
      dispatch({ type: "DISCONNECTED" });
    },
    [dispatch, media],
  );

  useEffect(
    () =>
      chat.subscribe((event) => {
        if (event.kind === "stageGranted") void runGrant();
        if (event.kind === "stageRevoked") void endSession("REVOKED");
      }),
    [chat, runGrant, endSession],
  );

  useEffect(
    () => () => {
      attemptRef.current += 1;
      void media.disconnect().catch(() => undefined);
    },
    [media],
  );

  const request = useCallback((): boolean => {
    if (!canRequest(stateRef.current)) return false;
    dispatch({ type: "REQUEST" });
    if (!chat.requestStage()) {
      dispatch({ type: "REQUEST_FAILED" });
      return false;
    }
    return true;
  }, [chat, dispatch]);

  /**
   * Quitter la scène : envoie stage:leave au serveur ET coupe le micro localement tout de suite.
   * L'état passe à « stopping » et n'est libéré qu'à réception de stage:revoked (confirmation serveur).
   */
  const leave = useCallback(() => {
    if (!isActive(stateRef.current)) return;
    attemptRef.current += 1;
    const sent = chat.leaveStage();
    dispatch({ type: "LEAVE" });
    void media.disconnect().catch(() => undefined);
    if (!sent) dispatch({ type: "LEAVE_FAILED" });
  }, [chat, dispatch, media]);

  const dismiss = useCallback(() => {
    dispatch({ type: "DISMISS" });
  }, [dispatch]);

  return { state, request, leave, dismiss };
}
