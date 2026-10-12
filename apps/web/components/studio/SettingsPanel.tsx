"use client";

import { useId } from "react";
import {
  BITRATE_OPTIONS_KBPS,
  CAPTURE_SOURCES,
  FPS_OPTIONS,
  RESOLUTIONS,
  type SettingKey,
  type StreamSettings,
} from "../../lib/studio/settings";
import type { SettingNotice } from "../../lib/studio/useStudio";
import { STRINGS } from "../../lib/i18n/strings";
import { StudioSection } from "./StudioSection";

interface SettingsPanelProps {
  settings: StreamSettings;
  notice: SettingNotice | null;
  onChange: (key: SettingKey, raw: string) => void;
}

interface Option {
  value: string;
  label: string;
}

const LABELS: Record<SettingKey, string> = {
  source: STRINGS.studio.settings.source,
  cameraId: STRINGS.studio.settings.camera,
  microphoneId: STRINGS.studio.settings.microphone,
  resolution: STRINGS.studio.settings.resolution,
  fps: STRINGS.studio.settings.fps,
  maxBitrateKbps: STRINGS.studio.settings.bitrate,
  simulcast: STRINGS.studio.settings.simulcast,
};

function outcomeText(notice: SettingNotice): string {
  switch (notice.outcome) {
    case "live":
      return STRINGS.studio.settings.applyLive;
    case "next_start":
      return STRINGS.studio.settings.applyNext;
    case "failed":
      return STRINGS.studio.settings.applyFailed;
  }
}

function SettingSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (raw: string) => void;
}) {
  return (
    <div className="studio-setting">
      <label htmlFor={id} className="studio-field-label">
        {label}
      </label>
      <select
        id={id}
        className="field"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Réglages de capture. Résolution, FPS et débit s'appliquent à chaud ; la source et le simulcast
 * attendent le prochain démarrage. Non persistés : aucune route serveur n'existe encore.
 */
export function SettingsPanel({ settings, notice, onChange }: SettingsPanelProps) {
  const baseId = useId();
  const resolutionOptions: Option[] = RESOLUTIONS.map((r) => ({
    value: String(r),
    label: STRINGS.studio.settings.resolutionLabel(r),
  }));
  const fpsOptions: Option[] = FPS_OPTIONS.map((f) => ({ value: String(f), label: String(f) }));
  const bitrateOptions: Option[] = BITRATE_OPTIONS_KBPS.map((b) => ({
    value: String(b),
    label: STRINGS.studio.settings.bitrateLabel(b),
  }));
  const simulcastOptions: Option[] = [
    { value: "on", label: STRINGS.studio.settings.on },
    { value: "off", label: STRINGS.studio.settings.off },
  ];
  const sourceOptions: Option[] = CAPTURE_SOURCES.map((source) => ({
    value: source,
    label:
      source === "camera"
        ? STRINGS.studio.settings.sourceCamera
        : STRINGS.studio.settings.sourceScreen,
  }));

  return (
    <StudioSection title={STRINGS.studio.settings.title} badge={STRINGS.studio.settings.saved}>
      <div className="studio-grid-4">
        <SettingSelect
          id={`${baseId}-source`}
          label={LABELS.source}
          value={settings.source}
          options={sourceOptions}
          onChange={(raw) => {
            onChange("source", raw);
          }}
        />
        <SettingSelect
          id={`${baseId}-resolution`}
          label={LABELS.resolution}
          value={String(settings.resolution)}
          options={resolutionOptions}
          onChange={(raw) => {
            onChange("resolution", raw);
          }}
        />
        <SettingSelect
          id={`${baseId}-fps`}
          label={LABELS.fps}
          value={String(settings.fps)}
          options={fpsOptions}
          onChange={(raw) => {
            onChange("fps", raw);
          }}
        />
        <SettingSelect
          id={`${baseId}-bitrate`}
          label={LABELS.maxBitrateKbps}
          value={String(settings.maxBitrateKbps)}
          options={bitrateOptions}
          onChange={(raw) => {
            onChange("maxBitrateKbps", raw);
          }}
        />
        <SettingSelect
          id={`${baseId}-simulcast`}
          label={LABELS.simulcast}
          value={settings.simulcast ? "on" : "off"}
          options={simulcastOptions}
          onChange={(raw) => {
            onChange("simulcast", raw);
          }}
        />
      </div>
      <p className="studio-hint" role="status">
        {notice ? `${LABELS[notice.key]} : ${outcomeText(notice)}.` : STRINGS.studio.browser.notice}
      </p>
    </StudioSection>
  );
}
