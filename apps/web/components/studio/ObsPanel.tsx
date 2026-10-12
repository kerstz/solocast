"use client";

import { useState } from "react";
import { STRINGS } from "../../lib/i18n/strings";
import type { IngestState } from "../../lib/studio/useIngest";

interface ObsPanelProps {
  ingest: IngestState;
}

type Field = "url" | "key";

/**
 * Onglet OBS : adresse RTMP et clé de flux de l'Ingress LiveKit, fournies par le serveur
 * (POST /api/studio/ingest). La clé est masquée par défaut : elle vaut droit de publier.
 */
export function ObsPanel({ ingest }: ObsPanelProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<Field | null>(null);
  const value = ingest.ingest;

  const copy = async (field: Field, text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
    } catch {
      // Presse-papiers refusé par le navigateur : le champ reste sélectionnable à la main.
      setCopied(null);
    }
  };

  const row = (field: Field, label: string, id: string, text: string, secret: boolean) => (
    <>
      <label className="studio-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="studio-copy-row">
        <input
          id={id}
          className="field mono"
          type={secret && !revealed ? "password" : "text"}
          value={text}
          readOnly
        />
        {secret ? (
          <button
            type="button"
            className="btn96"
            aria-pressed={revealed}
            onClick={() => {
              setRevealed(!revealed);
            }}
          >
            {revealed ? STRINGS.studio.obs.hide : STRINGS.studio.obs.reveal}
          </button>
        ) : null}
        <button
          type="button"
          className="btn96"
          onClick={() => {
            void copy(field, text);
          }}
        >
          {copied === field ? STRINGS.studio.obs.copied : STRINGS.studio.obs.copy}
        </button>
      </div>
    </>
  );

  return (
    <div className="studio-obs">
      <p className="studio-hint">{STRINGS.studio.obs.intro}</p>

      {ingest.phase === "loading" || ingest.phase === "idle" ? (
        <p className="studio-hint" role="status">
          {STRINGS.studio.obs.loading}
        </p>
      ) : null}

      {ingest.phase === "error" ? (
        <div className="form-col">
          <p className="studio-hint" role="alert" data-tone="error">
            {ingest.error}
          </p>
          <div className="form-actions">
            <button type="button" className="btn96" onClick={ingest.reload}>
              {STRINGS.studio.obs.retry}
            </button>
          </div>
        </div>
      ) : null}

      {ingest.phase === "ready" && value !== null ? (
        <>
          {row("url", STRINGS.studio.obs.url, "studio-ingest-url", value.url, false)}
          {row("key", STRINGS.studio.obs.key, "studio-ingest-key", value.streamKey, true)}
          <p className="studio-hint">{STRINGS.studio.obs.hint}</p>
        </>
      ) : null}
    </div>
  );
}
