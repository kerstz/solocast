"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, type ViewerBackend } from "../backend/types";
import type { QualityChoice, ReceivedVideo } from "../player/quality";
import {
  DEFAULT_SCREEN_ID,
  findScreenPreset,
  readScreenPreset,
  writeScreenPreset,
  type ScreenPreset,
} from "../player/screen";
import type { WatchRoom, WatchStatus } from "./room";

/** Delay before another join attempt when the session failed (streamer offline, SFU down). */
export const WATCH_RETRY_MS = 8_000;

export type WatchFault = "room_full";

export interface WatchFeed {
  status: WatchStatus;
  /** Cause connue d'un échec de session. `null` = échec sans cause précise (SFU injoignable). */
  fault: WatchFault | null;
  received: ReceivedVideo | undefined;
  quality: QualityChoice;
  setQuality: (choice: QualityChoice) => void;
  screen: ScreenPreset;
  setScreen: (id: string) => void;
  volume: number;
  setVolume: (volume: number) => void;
  /** Mutes the stream audio (viewer paused the player, or is on air). */
  setMuted: (muted: boolean) => void;
  attachVideo: (element: HTMLVideoElement | null) => void;
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Joins the WebRTC session and keeps the viewer's playback preferences.
 * The token is minted by the backend on every attempt: the client never reuses a stale one.
 */
export function useWatch(backend: ViewerBackend, room: WatchRoom, enabled: boolean): WatchFeed {
  const [status, setStatus] = useState<WatchStatus>("connecting");
  const [fault, setFault] = useState<WatchFault | null>(null);
  const [received, setReceived] = useState<ReceivedVideo | undefined>(undefined);
  const [quality, setQualityState] = useState<QualityChoice>("auto");
  const [screenId, setScreenId] = useState<string>(DEFAULT_SCREEN_ID);
  const [volume, setVolumeState] = useState(0.8);
  // Bumped to re-run the join effect after a failure (mint error, SFU down, session dropped).
  const [attempt, setAttempt] = useState(0);

  // Stored screen preset is read after mount: the server render must not depend on storage.
  useEffect(() => {
    setScreenId(readScreenPreset(localStorageOrNull()));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const join = async (): Promise<void> => {
      try {
        const token = await backend.mintToken();
        if (disposed) return;
        setFault(null);
        await room.connect(token, {
          onStatus: (next) => {
            if (!disposed) setStatus(next);
          },
          onReceived: (next) => {
            if (!disposed) setReceived(next);
          },
        });
      } catch (err) {
        if (disposed) return;
        // 503 room_full : le plafond MAX_VIEWERS est atteint. Le viewer n'a pas de place, la
        // boucle de reprise continue : une place peut se libérer.
        setFault(err instanceof ApiError && err.code === "room_full" ? "room_full" : null);
        setStatus("error");
      }
    };

    void join();
    return () => {
      disposed = true;
    };
  }, [backend, room, enabled, attempt]);

  // A failed or dropped session retries on its own: the streamer may simply be offline.
  useEffect(() => {
    if (!enabled || status !== "error") return;
    const timer = setTimeout(() => {
      setStatus("connecting");
      setAttempt((value) => value + 1);
    }, WATCH_RETRY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [enabled, status]);

  const setQuality = useCallback(
    (choice: QualityChoice) => {
      setQualityState(choice);
      room.setQuality(choice);
    },
    [room],
  );

  const setScreen = useCallback((id: string) => {
    setScreenId(id);
    writeScreenPreset(localStorageOrNull(), id);
  }, []);

  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      room.setVolume(next);
    },
    [room],
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      room.setMuted(muted);
    },
    [room],
  );

  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      room.attachVideo(element);
    },
    [room],
  );

  return {
    status,
    fault,
    received,
    quality,
    setQuality,
    screen: findScreenPreset(screenId),
    setScreen,
    volume,
    setVolume,
    setMuted,
    attachVideo,
  };
}
