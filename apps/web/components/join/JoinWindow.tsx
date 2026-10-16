"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type SubmitEvent } from "react";
import { PseudoSchema } from "@solocast/shared";
import { pickErrorMessage } from "../../lib/backend/errors";
import { STRINGS } from "../../lib/i18n/strings";
import { colorForUsername } from "../../lib/session/color";
import { useSession } from "../../lib/session/SessionProvider";
import { ScreenGlyph } from "../desk/icons";
import { TitleBar } from "../desk/WindowChrome";
import { Taskbar } from "../desk/Taskbar";

/** Recycle Bin shortcut: the one deliberate joke of this desktop, and it says so on hover. */
const BIN_HREF = "https://rickroll.it/";

/**
 * Home page: one question, a username. No account, no password, no key — the server still
 * owns the identity (opaque viewerId in an httpOnly cookie); the name is only a label.
 */
export function JoinWindow() {
  const router = useRouter();
  const session = useSession();
  const [username, setUsername] = useState(session.me?.pseudo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const parsed = PseudoSchema.safeParse(username.trim());
    if (!parsed.success) {
      setError(STRINGS.join.errors.invalid_input);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await session.setPseudo(parsed.data, colorForUsername(parsed.data));
      router.push("/watch");
    } catch (err) {
      setError(pickErrorMessage(STRINGS.join.errors, err, STRINGS.errors.generic));
      setSubmitting(false);
    }
  };

  return (
    <div className="desk">
      <main className="desk-main connexion-center">
        <nav className="desk-icon-row" aria-label={STRINGS.desk.desktopLabel}>
          <Link className="desk-icon" href="/watch">
            <svg width="34" height="34" viewBox="0 0 34 34" focusable="false">
              <rect x="4" y="3" width="26" height="22" rx="1" fill="#2b2b2b" stroke="#000" />
              <circle cx="17" cy="14" r="7" fill="#00ff66" />
              <circle cx="17" cy="14" r="3" fill="#003311" />
              <rect x="4" y="27" width="26" height="4" fill="#c0c0c0" stroke="#808080" />
            </svg>
            {STRINGS.desk.player}
          </Link>
          <a
            className="desk-icon"
            href={BIN_HREF}
            target="_blank"
            rel="noreferrer noopener"
            title={STRINGS.desk.binTitle}
          >
            <svg width="34" height="34" viewBox="0 0 34 34" focusable="false" aria-hidden="true">
              <path d="M7 9 h20 l-2 20 h-16 z" fill="#b8c6c6" stroke="#5a6a6a" />
              <rect x="6" y="6" width="22" height="4" fill="#9fb0b0" stroke="#5a6a6a" />
            </svg>
            {STRINGS.desk.bin}
          </a>
        </nav>

        <div className="win connexion-window">
          <TitleBar title={STRINGS.window.joinTitle} glyph={<ScreenGlyph />} />

          <div style={{ padding: 16 }}>
            <div className="connexion-logo">
              <LogoMark />
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-pixel), monospace",
                    fontSize: 18,
                    color: "#000080",
                    lineHeight: 1.2,
                    textShadow: "2px 2px 0 #c0c0c0, 3px 3px 0 #808080",
                  }}
                >
                  {STRINGS.brand}
                </div>
                <div
                  style={{ fontFamily: "var(--font-lcd), monospace", fontSize: 18, marginTop: 4 }}
                >
                  {STRINGS.join.logoSubtitle}
                </div>
              </div>
            </div>

            <div style={{ textAlign: "center", margin: "-4px 0 14px" }}>
              <span
                style={{
                  fontFamily: "var(--font-lcd), monospace",
                  fontSize: 17,
                  color: "#000080",
                }}
              >
                {STRINGS.join.slogan}
              </span>
            </div>

            <form onSubmit={(e) => void onSubmit(e)} className="tabpanel form-col">
              <p style={{ margin: "0 0 4px", fontSize: 12 }}>{STRINGS.join.intro}</p>
              <div className="form-row">
                <label htmlFor={fieldId}>{STRINGS.join.usernameLabel}&nbsp;:</label>
                <input
                  id={fieldId}
                  className="field mono"
                  type="text"
                  value={username}
                  maxLength={24}
                  autoComplete="nickname"
                  autoFocus
                  placeholder={STRINGS.join.usernamePlaceholder}
                  aria-invalid={error !== null}
                  aria-describedby={`${fieldId}-hint ${fieldId}-error`}
                  onChange={(e) => {
                    setUsername(e.target.value);
                  }}
                />
              </div>
              <p id={`${fieldId}-hint`} className="field-note">
                {STRINGS.join.hint}
              </p>
              <div className="form-actions">
                <button type="submit" className="btn96 btn96-primary" disabled={submitting}>
                  {submitting ? STRINGS.join.entering : STRINGS.join.enter}
                </button>
              </div>
              <p id={`${fieldId}-error`} className="error-text" role="alert">
                {error ?? ""}
              </p>
            </form>

            <div className="tabpanel form-col" style={{ textAlign: "center", marginTop: 12 }}>
              <p style={{ margin: 0, fontSize: 12 }}>{STRINGS.join.goLiveIntro}</p>
              <div className="form-actions" style={{ marginTop: 8 }}>
                <Link className="btn96" href="/studio">
                  {STRINGS.join.goLive}
                </Link>
              </div>
            </div>
            <p style={{ fontSize: 12, textAlign: "center", margin: "12px 0 0" }}>
              <Link href="/privacy">{STRINGS.join.privacyLink}</Link>
            </p>
          </div>
        </div>
      </main>

      <Taskbar>
        <span className="task active">{STRINGS.join.taskLabel}</span>
      </Taskbar>
    </div>
  );
}

/** Mock-up logo: green screen, red and yellow tally. */
function LogoMark() {
  return (
    <svg width="66" height="56" viewBox="0 0 66 56" aria-hidden="true" focusable="false">
      <rect
        x="2"
        y="8"
        width="52"
        height="38"
        rx="3"
        fill="#2b2b2b"
        stroke="#000"
        strokeWidth="2"
      />
      <rect x="7" y="13" width="42" height="28" fill="#0a3d2a" />
      <rect x="9" y="15" width="38" height="24" fill="#00ff66" opacity="0.18" />
      <circle cx="28" cy="27" r="9" fill="none" stroke="#00ff66" strokeWidth="2" />
      <rect x="25" y="23" width="6" height="8" fill="#00ff66" />
      <rect x="56" y="12" width="6" height="6" rx="3" fill="#ff3030" />
      <rect x="56" y="22" width="6" height="6" rx="3" fill="#ffd000" />
      <rect x="10" y="48" width="36" height="5" fill="#808080" />
    </svg>
  );
}
