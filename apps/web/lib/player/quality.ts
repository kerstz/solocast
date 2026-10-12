/**
 * Viewer-side quality choice. The streamer publishes up to three simulcast layers; the SFU
 * forwards the one this viewer asks for (or the best its bandwidth allows in `auto`).
 * Pure module: no LiveKit import, so it stays testable in Node.
 */

export const QUALITY_CHOICES = ["auto", "1080", "720", "360"] as const;
export type QualityChoice = (typeof QUALITY_CHOICES)[number];

/** Simulcast layer names used by LiveKit (`VideoQuality.HIGH | MEDIUM | LOW`). */
export type LayerName = "high" | "medium" | "low";

/** Layer for a user choice. `null` = let the SFU pick (auto). */
export function layerFor(choice: QualityChoice): LayerName | null {
  switch (choice) {
    case "auto":
      return null;
    case "1080":
      return "high";
    case "720":
      return "medium";
    case "360":
      return "low";
  }
}

export interface ReceivedVideo {
  width: number;
  height: number;
}

/** Label of what is actually decoded, e.g. "720p". `null` while nothing is playing. */
export function describeReceived(received: ReceivedVideo | undefined): string | null {
  if (!received || received.height <= 0) return null;
  return `${String(received.height)}p`;
}

/**
 * Label of a quality option. The layers are named, not sized: their real height depends on what
 * the streamer publishes, and the decoded size is shown separately ("Received").
 */
export function qualityLabel(choice: QualityChoice): string {
  switch (choice) {
    case "auto":
      return "Auto (best available)";
    case "1080":
      return "Source layer";
    case "720":
      return "Medium layer";
    case "360":
      return "Low layer";
  }
}

export function isQualityChoice(value: string): value is QualityChoice {
  return (QUALITY_CHOICES as readonly string[]).includes(value);
}
