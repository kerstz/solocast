import Link from "next/link";
import type { ReactNode } from "react";
import { STRINGS } from "../../lib/i18n/strings";
import { ScreenGlyph } from "./icons";

interface TitleBarProps {
  title: string;
  /** Lien de fermeture (retour à l'accueil). Absent : bouton fermer désactivé. */
  closeHref?: string;
  glyph?: ReactNode;
}

/** Barre de titre Win95 : dégradé bleu, titre de niveau 1, boutons _ ▢ ×. */
export function TitleBar({ title, closeHref, glyph = <ScreenGlyph /> }: TitleBarProps) {
  return (
    <div className="titlebar">
      <span className="titlebar-glyph">{glyph}</span>
      <h1 className="titlebar-title">{title}</h1>
      <button
        type="button"
        className="btn96 btn96-cap"
        disabled
        aria-label={STRINGS.window.minimize}
      >
        _
      </button>
      <button
        type="button"
        className="btn96 btn96-cap"
        disabled
        aria-label={STRINGS.window.maximize}
      >
        ▢
      </button>
      {closeHref ? (
        <Link className="btn96 btn96-cap close" href={closeHref} aria-label={STRINGS.window.close}>
          ×
        </Link>
      ) : (
        <button
          type="button"
          className="btn96 btn96-cap close"
          disabled
          aria-label={STRINGS.window.close}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function MenuBar() {
  const m = STRINGS.menu;
  return (
    <div className="menubar" role="presentation">
      <span>{m.file}</span>
      <span>{m.view}</span>
      <span>{m.channel}</span>
      <span>{m.help}</span>
    </div>
  );
}
