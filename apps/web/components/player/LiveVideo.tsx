"use client";

import { useEffect, useRef } from "react";
import { STRINGS } from "../../lib/i18n/strings";

export interface LiveVideoProps {
  /** Attaches (or detaches with `null`) the remote track to the element. */
  attach: (element: HTMLVideoElement | null) => void;
  playing: boolean;
  onAutoplayBlocked: () => void;
}

/**
 * Remote video element of the live stream. The track comes from the viewer's WebRTC session;
 * audio is handled by the session itself, so this element stays muted (no double audio).
 */
export function LiveVideo({ attach, playing, onAutoplayBlocked }: LiveVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blockedRef = useRef(onAutoplayBlocked);

  useEffect(() => {
    blockedRef.current = onAutoplayBlocked;
  });

  useEffect(() => {
    attach(videoRef.current);
    return () => {
      attach(null);
    };
  }, [attach]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {
        blockedRef.current();
      });
    } else {
      video.pause();
    }
  }, [playing]);

  return <video ref={videoRef} playsInline autoPlay muted aria-label={STRINGS.player.video} />;
}
