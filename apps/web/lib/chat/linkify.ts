export type TextSegment =
  { kind: "text"; value: string } | { kind: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/u;

function isSafeHttpUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Découpe un texte brut en segments. Seuls les liens http(s) deviennent des liens ;
 * tout le reste reste du texte (rendu React, jamais de HTML brut).
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    if (!isSafeHttpUrl(url)) continue;
    if (start > cursor) segments.push({ kind: "text", value: text.slice(cursor, start) });
    segments.push({ kind: "link", value: url, href: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) segments.push({ kind: "text", value: text.slice(cursor) });
  return segments;
}
