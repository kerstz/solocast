"use client";

import { useEffect, useState } from "react";
import { STRINGS } from "../../lib/i18n/strings";

/** Heure système. Rendue après montage pour éviter un écart d'hydratation. */
export function Clock() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      setLabel(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  return (
    <time className="task" aria-label={STRINGS.desk.clockLabel} suppressHydrationWarning>
      <span className="blink" style={{ color: "#d40000" }} aria-hidden="true">
        ●
      </span>{" "}
      {label ?? "--:--"}
    </time>
  );
}
