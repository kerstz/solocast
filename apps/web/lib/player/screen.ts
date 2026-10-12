/**
 * Screen presets of the player window: the viewer picks the size the video is rendered at,
 * like an old CRT resolution switch. Pure module (storage is passed in), so it is testable.
 */

export interface ScreenPreset {
  id: string;
  label: string;
  /** Rendered width in CSS pixels. `null` = fill the available column width. */
  width: number | null;
  /** Aspect ratio applied to the screen box (width / height). */
  ratio: number;
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  { id: "fit", label: "Fit window (16:9)", width: null, ratio: 16 / 9 },
  { id: "fit43", label: "Fit window (4:3)", width: null, ratio: 4 / 3 },
  { id: "640x480", label: "640 × 480 (4:3)", width: 640, ratio: 4 / 3 },
  { id: "800x600", label: "800 × 600 (4:3)", width: 800, ratio: 4 / 3 },
  { id: "1024x768", label: "1024 × 768 (4:3)", width: 1024, ratio: 4 / 3 },
  { id: "1280x720", label: "1280 × 720 (16:9)", width: 1280, ratio: 16 / 9 },
  { id: "1920x1080", label: "1920 × 1080 (16:9)", width: 1920, ratio: 16 / 9 },
] as const;

export const DEFAULT_SCREEN_ID = "fit";
export const SCREEN_STORAGE_KEY = "solocast.screen";

export function findScreenPreset(id: string): ScreenPreset {
  return SCREEN_PRESETS.find((preset) => preset.id === id) ?? (SCREEN_PRESETS[0] as ScreenPreset);
}

export function isScreenPresetId(value: string): boolean {
  return SCREEN_PRESETS.some((preset) => preset.id === value);
}

/** Inline style of the screen box. A fixed width never exceeds the viewport (`max-width: 100%`). */
export function screenStyle(preset: ScreenPreset): {
  width: string;
  maxWidth: string;
  aspectRatio: string;
} {
  return {
    width: preset.width === null ? "100%" : `${String(preset.width)}px`,
    maxWidth: "100%",
    aspectRatio: String(preset.ratio),
  };
}

/** Minimal storage port: `localStorage` in the browser, a fake in tests. */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readScreenPreset(storage: PresetStorage | null): string {
  if (storage === null) return DEFAULT_SCREEN_ID;
  try {
    const stored = storage.getItem(SCREEN_STORAGE_KEY);
    return stored !== null && isScreenPresetId(stored) ? stored : DEFAULT_SCREEN_ID;
  } catch {
    // Private mode or blocked storage: the default preset is always usable.
    return DEFAULT_SCREEN_ID;
  }
}

export function writeScreenPreset(storage: PresetStorage | null, id: string): void {
  if (storage === null || !isScreenPresetId(id)) return;
  try {
    storage.setItem(SCREEN_STORAGE_KEY, id);
  } catch {
    // Storage unavailable: the choice simply does not survive a reload.
  }
}
