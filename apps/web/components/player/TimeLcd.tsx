"use client";

import { useEffect, useState } from "react";
import { STRINGS } from "../../lib/i18n/strings";
import { formatElapsed } from "../../lib/player/time";

/** Compteur LCD : durée de lecture du direct depuis le premier affichage. */
export function TimeLcd({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [startedAt]);

  const text = startedAt === null ? "--:--:--" : formatElapsed(now - startedAt);
  return (
    <output className="time-lcd" aria-label={STRINGS.player.timeLabel}>
      {text}
    </output>
  );
}
