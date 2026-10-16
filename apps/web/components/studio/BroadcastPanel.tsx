"use client";

import type { RefObject } from "react";
import type { BroadcastMode, BroadcastPhase, StudioController } from "../../lib/studio/useStudio";
import { STRINGS } from "../../lib/i18n/strings";
import { getViewerBackend } from "../../lib/backend";
import { useIngest } from "../../lib/studio/useIngest";
import { ObsPanel } from "./ObsPanel";
import { StudioSection } from "./StudioSection";

interface BroadcastPanelProps {
  studio: StudioController;
  previewRef: RefObject<HTMLVideoElement | null>;
  /** false dans l'application installée : pas de service Ingress, donc pas d'onglet OBS. */
  obsAvailable: boolean;
  /** Serveur vidéo absent ou en échec : « Go live » ne peut pas réussir. */
  videoUnavailable: boolean;
}

const MODES: readonly BroadcastMode[] = ["browser", "obs"];

function toggleLabel(phase: BroadcastPhase): string {
  switch (phase) {
    case "idle":
      return STRINGS.studio.browser.start;
    case "starting":
      return STRINGS.studio.browser.starting;
    case "live":
      return STRINGS.studio.browser.stop;
    case "stopping":
      return STRINGS.studio.browser.stopping;
  }
}

/**
 * Diffusion : OBS (URL RTMP + clé de flux de l'Ingress LiveKit) ou Navigateur
 * (caméra ou partage d'écran, plus le micro, publiés via livekit-client après token serveur).
 */
export function BroadcastPanel({
  studio,
  previewRef,
  obsAvailable,
  videoUnavailable,
}: BroadcastPanelProps) {
  const { phase, fault } = studio;
  const mode = obsAvailable ? studio.mode : "browser";
  // Demandé au serveur seulement quand l'onglet OBS est affiché.
  const ingest = useIngest(getViewerBackend(), mode === "obs");
  const idle = phase === "idle";
  const live = phase === "live";
  // Le libellé suit la source choisie : annoncer la caméra en partage d'écran serait faux.
  const screenShare = studio.settings.source === "screen";
  const faultText = fault ? STRINGS.studio.broadcastErrors[fault] : null;

  const modeLabel = (m: BroadcastMode): string =>
    m === "obs" ? STRINGS.studio.modes.obs : STRINGS.studio.modes.browser;

  return (
    <StudioSection title={STRINGS.studio.broadcastTitle}>
      <div
        className="studio-tabs"
        role="group"
        aria-label={STRINGS.studio.modes.label}
        hidden={!obsAvailable}
      >
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            className="btn96 studio-tab"
            aria-pressed={mode === m}
            disabled={!idle}
            onClick={() => {
              studio.setMode(m);
            }}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>

      {mode === "obs" ? (
        <ObsPanel ingest={ingest} />
      ) : (
        <div className="studio-browser">
          <div className="studio-preview-row">
            {/* Aperçu local seulement : le flux part vers le SFU, jamais vers un autre élément. */}
            <video
              ref={previewRef}
              className="studio-preview"
              muted
              playsInline
              autoPlay
              aria-label={STRINGS.studio.browser.preview}
            />
            <div className="studio-preview-side">
              <p className="studio-hint" role="status" data-tone={faultText ? "error" : undefined}>
                {faultText ??
                  (live
                    ? STRINGS.studio.browser.liveHint(screenShare)
                    : STRINGS.studio.browser.idleHint(screenShare))}
              </p>
              <button
                type="button"
                className={live ? "btn96" : "btn96 btn96-primary"}
                disabled={!(idle || live) || (idle && videoUnavailable)}
                onClick={live ? studio.stop : studio.start}
              >
                {toggleLabel(phase)}
              </button>
            </div>
          </div>
        </div>
      )}
    </StudioSection>
  );
}
