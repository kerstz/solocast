import Link from "next/link";
import { STRINGS } from "../../lib/i18n/strings";
import { Taskbar } from "../desk/Taskbar";
import { ScreenGlyph } from "../desk/icons";
import { TitleBar } from "../desk/WindowChrome";

/** Politique de confidentialité : texte dans STRINGS.privacy, rendu sans état (export statique). */
export function PrivacyScreen() {
  const P = STRINGS.privacy;
  return (
    <div className="desk">
      <main className="desk-main connexion-center">
        <article className="win window-frame" aria-labelledby="privacy-title">
          <TitleBar title={P.windowTitle} closeHref="/" glyph={<ScreenGlyph />} />
          <div className="tabpanel" style={{ padding: 16, overflowY: "auto", maxHeight: "75vh" }}>
            <h2 id="privacy-title" style={{ marginTop: 0 }}>
              {P.link}
            </h2>
            <p role="note" className="field-note">
              <strong>{P.draftNotice}</strong>
            </p>
            {P.sections.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                {"paragraphs" in section
                  ? section.paragraphs.map((text) => <p key={text}>{text}</p>)
                  : null}
                {"items" in section ? (
                  <ul>
                    {section.items.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            <p style={{ fontSize: 12 }}>
              <Link href="/">{P.backHome}</Link> · <Link href="/watch">{P.backWatch}</Link>
            </p>
          </div>
        </article>
      </main>
      <Taskbar>
        <span className="task active">{P.taskLabel}</span>
      </Taskbar>
    </div>
  );
}
