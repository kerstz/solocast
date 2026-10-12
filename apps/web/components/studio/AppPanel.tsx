"use client";

import { useState } from "react";
import { STRINGS } from "../../lib/i18n/strings";
import type { AppControlState } from "../../lib/studio/useAppControl";
import { StudioSection } from "./StudioSection";

interface AppPanelProps {
  app: AppControlState;
}

/**
 * Partage et arrêt de l'application installée. Remplace les options de terminal : l'adresse
 * publique s'ouvre et se ferme ici, et SoloCast s'arrête d'ici. Affiché seulement quand le serveur
 * répond à /api/app/status (application installée, depuis cette machine).
 */
export function AppPanel({ app }: AppPanelProps) {
  const { status, busy, error, stopped } = app;
  const [copied, setCopied] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const S = STRINGS.studio.app;

  if (stopped) {
    return (
      <StudioSection title={S.title}>
        <p className="studio-hint" role="status">
          {S.stopped}
        </p>
      </StudioSection>
    );
  }
  if (status === null) return null;

  const { state, url } = status.share;
  const on = state === "on" && url !== null;
  const hint =
    state === "unavailable" ? S.unavailable : state === "starting" ? S.starting : on ? S.on : S.off;

  const copy = async (): Promise<void> => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <StudioSection title={S.title} badge={S.version(status.version)}>
      <p
        className="studio-hint"
        role="status"
        data-tone={state === "unavailable" ? "error" : undefined}
      >
        {hint}
      </p>

      {on ? (
        <>
          <label className="studio-field-label" htmlFor="studio-share-url">
            {S.shareLabel}
          </label>
          <div className="studio-copy-row">
            <input id="studio-share-url" className="field mono" type="text" value={url} readOnly />
            <button
              type="button"
              className="btn96"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? S.copied : S.copy}
            </button>
          </div>
          <p className="studio-hint">{S.linkChanges}</p>
          {status.video ? (
            <p className="studio-hint">{S.ports(status.mediaPorts.tcp, status.mediaPorts.udp)}</p>
          ) : null}
        </>
      ) : null}

      {!status.video ? (
        <p className="studio-hint" data-tone="error">
          <strong>{S.noVideoTitle}.</strong> {S.noVideo}
        </p>
      ) : null}

      <div className="form-actions">
        <button
          type="button"
          className={on ? "btn96" : "btn96 btn96-primary"}
          disabled={busy || state === "starting"}
          onClick={app.toggleShare}
        >
          {on ? S.disable : S.enable}
        </button>

        {confirmQuit ? (
          <>
            <button
              type="button"
              className="btn96 studio-btn-danger"
              disabled={busy}
              onClick={app.quit}
            >
              {S.quitConfirm}
            </button>
            <button
              type="button"
              className="btn96"
              onClick={() => {
                setConfirmQuit(false);
              }}
            >
              {S.quitCancel}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn96"
            onClick={() => {
              setConfirmQuit(true);
            }}
          >
            {S.quit}
          </button>
        )}
      </div>
      {confirmQuit ? <p className="studio-hint">{S.quitWarning}</p> : null}

      {error !== null ? (
        <p className="studio-alert" role="alert">
          {error}
        </p>
      ) : null}
    </StudioSection>
  );
}
