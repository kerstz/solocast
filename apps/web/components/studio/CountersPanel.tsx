"use client";

import { MAX_SPEAKERS, type PresenceUpdate } from "@solocast/shared";
import { presenceAgeSeconds, formatSpeakers } from "../../lib/studio/counters";
import { STRINGS } from "../../lib/i18n/strings";
import { StudioSection } from "./StudioSection";

interface CountersPanelProps {
  presence: PresenceUpdate | null;
  presenceAt: number | null;
  now: number;
  /** This studio is publishing right now (browser capture). Known locally, before any webhook. */
  publishing: boolean;
}

/** Trois compteurs réels : viewers et speakers (presence:update), direct (SFU ou diffusion locale). */
export function CountersPanel({ presence, presenceAt, now, publishing }: CountersPanelProps) {
  // Jauge réelle : viewers connectés sur le plafond MAX_VIEWERS annoncé par le serveur.
  const viewers = presence ? `${String(presence.count)}/${String(presence.maxViewers)}` : "—";
  const speakers = formatSpeakers(presence?.speakers ?? null, MAX_SPEAKERS);
  // Two honest sources: this browser publishing, or the SFU reporting the streamer (OBS ingest).
  const live =
    publishing || presence?.live === true
      ? STRINGS.studio.counters.liveOn
      : presence === null
        ? "—"
        : STRINGS.studio.counters.liveOff;
  const age = STRINGS.studio.counters.updatedAt(presenceAgeSeconds(now, presenceAt));

  return (
    <StudioSection title={STRINGS.studio.countersTitle}>
      <dl className="studio-counters">
        <div className="studio-counter">
          <dt>{STRINGS.studio.counters.viewers}</dt>
          <dd className="studio-counter-value">{viewers}</dd>
        </div>
        <div className="studio-counter">
          <dt>{STRINGS.studio.counters.speakers}</dt>
          <dd className="studio-counter-value">{speakers}</dd>
        </div>
        <div className="studio-counter">
          <dt>{STRINGS.studio.counters.live}</dt>
          <dd className="studio-counter-value">{live}</dd>
        </div>
      </dl>
      <p className="studio-hint">{age}</p>
    </StudioSection>
  );
}
