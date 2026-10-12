"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import type { PresenceUpdate } from "@solocast/shared";
import type { ViewerBackend } from "../backend/types";
import { useChat, type ChatFeed } from "../chat/useChat";
import { BroadcastError, type BrowserBroadcaster, type BroadcastErrorCode } from "./broadcaster";
import { COUNTERS_REFRESH_MS, isSpeakerCapReached } from "./counters";
import { INITIAL_SCENE_STATE, sceneReducer, type SceneActionKind, type SceneState } from "./scene";
import {
  changedSettings,
  DEFAULT_STREAM_SETTINGS,
  SETTING_APPLY_MODE,
  setStreamSetting,
  type SettingKey,
  type StreamSettings,
} from "./settings";

export type BroadcastMode = "obs" | "browser";
export type BroadcastPhase = "idle" | "starting" | "live" | "stopping";
/** Panne de diffusion : erreur au démarrage, ou coupure inattendue (« lost »). */
export type BroadcastFault = BroadcastErrorCode | "lost";

/** Issue d'un réglage : appliqué à chaud, prévu au prochain démarrage, ou échec d'application. */
export interface SettingNotice {
  key: SettingKey;
  outcome: "live" | "next_start" | "failed";
}

export interface StudioController {
  chat: ChatFeed;
  presence: PresenceUpdate | null;
  presenceAt: number | null;
  /** Horloge rafraîchie toutes les COUNTERS_REFRESH_MS : sert à l'âge des compteurs. */
  now: number;
  scene: SceneState;
  capReached: boolean;
  settings: StreamSettings;
  settingNotice: SettingNotice | null;
  mode: BroadcastMode;
  phase: BroadcastPhase;
  fault: BroadcastFault | null;
  setSetting: (key: SettingKey, raw: string) => void;
  setMode: (mode: BroadcastMode) => void;
  start: () => void;
  stop: () => void;
  grant: (viewerId: string) => void;
  revoke: (viewerId: string) => void;
  ban: (viewerId: string) => void;
  dismissFailure: () => void;
}

/**
 * Orchestration du studio : socket chat (streameur), file de parole, réglages, diffusion navigateur.
 * Aucune autorité ici : chaque action attend la réponse 204 du serveur avant de changer la liste.
 */
export function useStudio(
  backend: ViewerBackend,
  broadcaster: BrowserBroadcaster,
  previewRef: RefObject<HTMLVideoElement>,
): StudioController {
  const chat = useChat(backend, true);
  const [scene, dispatchScene] = useReducer(sceneReducer, INITIAL_SCENE_STATE);
  const [settings, setSettings] = useState<StreamSettings>(DEFAULT_STREAM_SETTINGS);
  const [settingNotice, setSettingNotice] = useState<SettingNotice | null>(null);
  const [mode, setModeState] = useState<BroadcastMode>("browser");
  const [phase, setPhase] = useState<BroadcastPhase>("idle");
  const [fault, setFault] = useState<BroadcastFault | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Refs lues par les callbacks : évitent les fermetures périmées pendant une diffusion.
  const settingsRef = useRef(settings);
  const phaseRef = useRef(phase);
  const inFlightRef = useRef(new Set<string>());
  const presence = chat.presence;
  const presenceRef = useRef(presence);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, COUNTERS_REFRESH_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(
    () =>
      chat.client.subscribe((event) => {
        if (event.kind === "stageRequest") {
          dispatchScene({
            type: "request_received",
            viewerId: event.viewerId,
            pseudo: event.pseudo,
          });
        }
      }),
    [chat.client],
  );

  // Démontage : on coupe la diffusion navigateur pour ne jamais laisser la caméra allumée.
  useEffect(
    () => () => {
      void broadcaster.stop().catch(() => undefined);
    },
    [broadcaster],
  );

  const setSetting = useCallback(
    (key: SettingKey, raw: string) => {
      const prev = settingsRef.current;
      const next = setStreamSetting(prev, key, raw);
      if (!next) return;
      settingsRef.current = next;
      setSettings(next);
      if (changedSettings(prev, next).length === 0) return;

      // Hors antenne : le réglage attend le prochain démarrage.
      if (phaseRef.current !== "live") {
        setSettingNotice({ key, outcome: "next_start" });
        return;
      }
      if (SETTING_APPLY_MODE[key] === "next_start") {
        setSettingNotice({ key, outcome: "next_start" });
        return;
      }
      broadcaster
        .applySettings(next, [key])
        .then(() => {
          setSettingNotice({ key, outcome: "live" });
        })
        .catch(() => {
          setSettingNotice({ key, outcome: "failed" });
        });
    },
    [broadcaster],
  );

  const setMode = useCallback((next: BroadcastMode) => {
    if (phaseRef.current !== "idle") return;
    setModeState(next);
  }, []);

  const start = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current = "starting";
    setPhase("starting");
    setFault(null);
    void (async () => {
      try {
        // Le token serveur décide des droits de publication (vidéo + audio pour le streameur).
        const token = await backend.mintToken();
        await broadcaster.start(token, settingsRef.current, previewRef.current, {
          onLost: () => {
            phaseRef.current = "idle";
            setPhase("idle");
            setFault("lost");
          },
        });
        phaseRef.current = "live";
        setPhase("live");
      } catch (err) {
        await broadcaster.stop().catch(() => undefined);
        phaseRef.current = "idle";
        setPhase("idle");
        setFault(err instanceof BroadcastError ? err.code : "failed");
      }
    })();
  }, [backend, broadcaster, previewRef]);

  const stop = useCallback(() => {
    if (phaseRef.current !== "live") return;
    phaseRef.current = "stopping";
    setPhase("stopping");
    void broadcaster
      .stop()
      .catch(() => undefined)
      .finally(() => {
        phaseRef.current = "idle";
        setPhase("idle");
      });
  }, [broadcaster]);

  /** Exécute une action serveur sur un viewer : un seul appel à la fois par viewer. */
  const runAction = useCallback(
    (viewerId: string, action: SceneActionKind, call: () => Promise<void>, onOk: () => void) => {
      if (inFlightRef.current.has(viewerId)) return;
      inFlightRef.current.add(viewerId);
      dispatchScene({ type: "action_started", viewerId, action });
      call()
        .then(() => {
          onOk();
        })
        .catch(() => {
          dispatchScene({ type: "action_failed", viewerId, action });
        })
        .finally(() => {
          inFlightRef.current.delete(viewerId);
        });
    },
    [],
  );

  const grant = useCallback(
    (viewerId: string) => {
      // Plafond vérifié aussi ici : l'UI le désactive déjà, le serveur reste l'autorité.
      if (isSpeakerCapReached(presenceRef.current?.speakers ?? null)) return;
      runAction(
        viewerId,
        "grant",
        () => backend.grantStage(viewerId),
        () => {
          dispatchScene({ type: "grant_succeeded", viewerId });
        },
      );
    },
    [backend, runAction],
  );

  const revoke = useCallback(
    (viewerId: string) => {
      runAction(
        viewerId,
        "revoke",
        () => backend.revokeStage(viewerId),
        () => {
          dispatchScene({ type: "revoke_succeeded", viewerId });
        },
      );
    },
    [backend, runAction],
  );

  const ban = useCallback(
    (viewerId: string) => {
      runAction(
        viewerId,
        "ban",
        () => backend.banViewer({ viewerId }),
        () => {
          dispatchScene({ type: "ban_succeeded", viewerId });
        },
      );
    },
    [backend, runAction],
  );

  const dismissFailure = useCallback(() => {
    dispatchScene({ type: "failure_dismissed" });
  }, []);

  return {
    chat,
    presence,
    presenceAt: chat.presenceAt,
    now,
    scene,
    capReached: isSpeakerCapReached(presence?.speakers ?? null),
    settings,
    settingNotice,
    mode,
    phase,
    fault,
    setSetting,
    setMode,
    start,
    stop,
    grant,
    revoke,
    ban,
    dismissFailure,
  };
}
