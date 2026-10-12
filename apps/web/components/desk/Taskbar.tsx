import Link from "next/link";
import type { ReactNode } from "react";
import { STRINGS } from "../../lib/i18n/strings";
import { FlagGlyph } from "./icons";
import { Clock } from "./Clock";

/** Barre des tâches : bouton Démarrer (retour accueil), tâches, horloge. */
export function Taskbar({ children }: { children?: ReactNode }) {
  return (
    <nav className="taskbar" aria-label="Barre des tâches">
      <Link className="btn96 start-button" href="/">
        <FlagGlyph />
        {STRINGS.desk.start}
      </Link>
      <span className="bevel-in-light" style={{ width: 2, height: 22 }} aria-hidden="true" />
      {children}
      <span className="spacer" />
      <Clock />
    </nav>
  );
}
