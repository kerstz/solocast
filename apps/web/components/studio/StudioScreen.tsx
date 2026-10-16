"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type SubmitEvent } from "react";
import { getViewerBackend } from "../../lib/backend";
import { openStudioWith } from "../../lib/studio/openStudio";
import { pickErrorMessage } from "../../lib/backend/errors";
import { STRINGS } from "../../lib/i18n/strings";
import { Taskbar } from "../desk/Taskbar";
import { ScreenGlyph } from "../desk/icons";
import { TitleBar } from "../desk/WindowChrome";
import { StudioConsole } from "./StudioConsole";

type Gate = "opening" | "open" | "failed" | "key";

/**
 * Studio gate. No key: arriving on the page posts POST /api/studio/open, which takes the single
 * studio slot and answers with the httpOnly studio cookie — the only authority of the streamer
 * routes. A browser that already holds the cookie walks straight in (GET /api/me says
 * role=streamer), so a reload keeps the console without touching the slot.
 */
export function StudioScreen() {
  const [gate, setGate] = useState<Gate>("opening");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // La clé reste en état React le temps de l'appel : ni stockage, ni URL.
  const [studioKey, setStudioKey] = useState("");
  const [keyWrong, setKeyWrong] = useState(false);
  const [checking, setChecking] = useState(false);
  const keyFieldId = useId();

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    // Drapeau lu via une fonction : le cleanup le mute après coup, donc chaque reprise après
    // `await` relit la valeur courante au lieu de celle de l'initialisation.
    const run = { cancelled: false };
    const stopped = (): boolean => run.cancelled;
    void (async () => {
      setGate("opening");
      setError(null);
      const backend = getViewerBackend();
      try {
        const result = await openStudioWith(backend);
        if (stopped()) return;
        setGate(result === "open" ? "open" : "key");
      } catch (err) {
        if (stopped()) return;
        setError(pickErrorMessage(STRINGS.studio.gate.errors, err, STRINGS.errors.generic));
        setGate("failed");
      }
    })();
    return () => {
      run.cancelled = true;
    };
  }, [attempt]);

  const submitKey = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (checking || studioKey === "") return;
    setChecking(true);
    setKeyWrong(false);
    try {
      const result = await openStudioWith(getViewerBackend(), studioKey);
      if (result === "open") {
        setGate("open");
      } else {
        setKeyWrong(true);
      }
    } catch (err) {
      setError(pickErrorMessage(STRINGS.studio.gate.errors, err, STRINGS.errors.generic));
      setGate("failed");
    } finally {
      setStudioKey("");
      setChecking(false);
    }
  };

  if (gate === "open") {
    return <StudioConsole />;
  }

  return (
    <div className="desk">
      <main className="desk-main connexion-center">
        {gate === "opening" ? (
          <p role="status" className="studio-hint">
            {STRINGS.studio.opening}
          </p>
        ) : gate === "key" ? (
          <div className="win connexion-window">
            <TitleBar title={STRINGS.studio.gate.title} closeHref="/" glyph={<ScreenGlyph />} />
            <form style={{ padding: 16 }} className="form-col" onSubmit={(e) => void submitKey(e)}>
              <p style={{ margin: "0 0 4px", fontSize: 12 }}>{STRINGS.studio.gate.keyIntro}</p>
              <div className="form-row">
                <label htmlFor={keyFieldId}>{STRINGS.studio.gate.keyLabel}&nbsp;:</label>
                <input
                  id={keyFieldId}
                  className="field mono"
                  type="password"
                  value={studioKey}
                  maxLength={256}
                  autoComplete="off"
                  autoFocus
                  aria-invalid={keyWrong}
                  aria-describedby={`${keyFieldId}-error`}
                  onChange={(e) => {
                    setStudioKey(e.target.value);
                  }}
                />
              </div>
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn96 btn96-primary"
                  disabled={checking || studioKey === ""}
                >
                  {checking ? STRINGS.studio.gate.keyChecking : STRINGS.studio.gate.keySubmit}
                </button>
              </div>
              <p id={`${keyFieldId}-error`} className="error-text" role="alert">
                {keyWrong ? STRINGS.studio.gate.keyWrong : ""}
              </p>
              <p style={{ fontSize: 12, textAlign: "center", marginBottom: 0 }}>
                <Link href="/">{STRINGS.studio.back}</Link>
              </p>
            </form>
          </div>
        ) : (
          <div className="win connexion-window">
            <TitleBar title={STRINGS.studio.gate.title} closeHref="/" glyph={<ScreenGlyph />} />
            <div style={{ padding: 16 }}>
              <p className="error-text" role="alert">
                {error ?? STRINGS.errors.generic}
              </p>
              <div className="form-actions">
                <button type="button" className="btn96 btn96-primary" onClick={retry}>
                  {STRINGS.studio.gate.retry}
                </button>
              </div>
              <p style={{ fontSize: 12, textAlign: "center", marginBottom: 0 }}>
                <Link href="/">{STRINGS.studio.back}</Link>
              </p>
            </div>
          </div>
        )}
      </main>
      <Taskbar>
        <span className="task active">{STRINGS.studio.taskLabel}</span>
      </Taskbar>
    </div>
  );
}
