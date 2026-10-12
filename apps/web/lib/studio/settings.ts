/**
 * Studio capture settings. Pure module: no side effect, no DOM.
 * No server route exists for them: the studio keeps them in this browser (localStorage, see
 * `serializeSettings` / `restoreSettings`) so a reload or a relaunch finds them again.
 */

export const CAPTURE_SOURCES = ["camera", "screen"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const RESOLUTIONS = [1080, 720, 480] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const FPS_OPTIONS = [30, 60] as const;
export type Fps = (typeof FPS_OPTIONS)[number];

/** Published bitrate ceiling, in kbit/s. 6000 ≈ a 1080p60 source layer. */
export const BITRATE_OPTIONS_KBPS = [1500, 3000, 4500, 6000] as const;
export type BitrateKbps = (typeof BITRATE_OPTIONS_KBPS)[number];

export interface StreamSettings {
  /** Camera or screen share. Changing it needs a republish, so it applies at the next start. */
  source: CaptureSource;
  /** `null` = let the browser pick the default device. */
  cameraId: string | null;
  microphoneId: string | null;
  resolution: Resolution;
  fps: Fps;
  maxBitrateKbps: BitrateKbps;
  simulcast: boolean;
}

export type SettingKey = keyof StreamSettings;

export const SETTING_KEYS: readonly SettingKey[] = [
  "source",
  "cameraId",
  "microphoneId",
  "resolution",
  "fps",
  "maxBitrateKbps",
  "simulcast",
];

export const DEFAULT_STREAM_SETTINGS: StreamSettings = {
  source: "camera",
  cameraId: null,
  microphoneId: null,
  // 720p30 à 3000 kb/s : tient dans une liaison montante domestique ordinaire.
  resolution: 720,
  fps: 30,
  maxBitrateKbps: 3000,
  simulcast: true,
};

/**
 * Honest apply mode per setting:
 * - live: applied to the running track (applyConstraints / RTCRtpSender / switchActiveDevice);
 * - next_start: the simulcast layout and the capture source are negotiated at publish time.
 */
export const SETTING_APPLY_MODE: Readonly<Record<SettingKey, "live" | "next_start">> = {
  source: "next_start",
  cameraId: "live",
  microphoneId: "live",
  resolution: "live",
  fps: "live",
  maxBitrateKbps: "live",
  simulcast: "next_start",
};

const RESOLUTION_DIMENSIONS: Readonly<Record<Resolution, { width: number; height: number }>> = {
  1080: { width: 1920, height: 1080 },
  720: { width: 1280, height: 720 },
  480: { width: 854, height: 480 },
};

export function resolutionDimensions(resolution: Resolution): { width: number; height: number } {
  return RESOLUTION_DIMENSIONS[resolution];
}

/** Device id out of a `<select>` value: the empty string means "system default". */
function deviceIdOf(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Updates one setting from a raw `<select>` value (string).
 * Returns null when the value is not in the allowed list: the state stays unchanged.
 */
export function setStreamSetting(
  settings: StreamSettings,
  key: SettingKey,
  raw: string,
): StreamSettings | null {
  switch (key) {
    case "source": {
      const value = CAPTURE_SOURCES.find((source) => source === raw);
      return value === undefined ? null : { ...settings, source: value };
    }
    case "cameraId":
      return { ...settings, cameraId: deviceIdOf(raw) };
    case "microphoneId":
      return { ...settings, microphoneId: deviceIdOf(raw) };
    case "resolution": {
      const value = RESOLUTIONS.find((r) => String(r) === raw);
      return value === undefined ? null : { ...settings, resolution: value };
    }
    case "fps": {
      const value = FPS_OPTIONS.find((f) => String(f) === raw);
      return value === undefined ? null : { ...settings, fps: value };
    }
    case "maxBitrateKbps": {
      const value = BITRATE_OPTIONS_KBPS.find((b) => String(b) === raw);
      return value === undefined ? null : { ...settings, maxBitrateKbps: value };
    }
    case "simulcast":
      if (raw !== "on" && raw !== "off") return null;
      return { ...settings, simulcast: raw === "on" };
  }
}

/** Settings that actually changed between two states (so only the delta is applied). */
export function changedSettings(prev: StreamSettings, next: StreamSettings): SettingKey[] {
  return SETTING_KEYS.filter((key) => prev[key] !== next[key]);
}

/** Device ids are not kept: a camera unplugged since would make the next start fail. */
const PERSISTED_KEYS = ["source", "resolution", "fps", "maxBitrateKbps", "simulcast"] as const;

export const SETTINGS_STORAGE_KEY = "solocast.studio.settings.v1";

export function serializeSettings(settings: StreamSettings): string {
  const subset: Record<string, string> = {};
  for (const key of PERSISTED_KEYS) {
    const value = settings[key];
    subset[key] = typeof value === "boolean" ? (value ? "on" : "off") : String(value);
  }
  return JSON.stringify(subset);
}

/** Reads back what `serializeSettings` wrote; anything invalid falls back to the default. */
export function restoreSettings(raw: string | null): StreamSettings {
  if (raw === null) return DEFAULT_STREAM_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_STREAM_SETTINGS;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_STREAM_SETTINGS;
  let settings = DEFAULT_STREAM_SETTINGS;
  for (const key of PERSISTED_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    settings = setStreamSetting(settings, key, value) ?? settings;
  }
  return settings;
}
