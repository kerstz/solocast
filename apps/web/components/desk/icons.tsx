/** Pictogrammes SVG de la maquette. Décoratifs : aria-hidden, le texte porte le sens. */

export function ScreenGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1" y="2" width="14" height="10" fill="#00ff66" stroke="#003311" />
      <rect x="5" y="13" width="6" height="2" fill="#dfdfdf" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg width="13" height="18" viewBox="0 0 16 22" aria-hidden="true" focusable="false">
      <rect x="5" y="1" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M2 10 a6 6 0 0 0 12 0" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="7" y="16" width="2" height="4" fill="currentColor" />
    </svg>
  );
}

export function StreamerStar() {
  return (
    <svg width="11" height="9" viewBox="0 0 12 10" aria-hidden="true" focusable="false">
      <path d="M1 9 L1 3 L4 6 L6 1 L8 6 L11 3 L11 9 Z" fill="#3f2900" />
    </svg>
  );
}

export function ChatGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 2 h12 v8 h-7 l-3 3 v-3 h-2 z" fill="#fff" />
    </svg>
  );
}

export function FlagGlyph() {
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true" focusable="false">
      <rect x="0" y="1" width="8" height="6" fill="#ff2d2d" />
      <rect x="9" y="1" width="8" height="6" fill="#00a000" />
      <rect x="0" y="8" width="8" height="6" fill="#0000cc" />
      <rect x="9" y="8" width="8" height="6" fill="#ffd000" />
    </svg>
  );
}

export function EyeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1" y="2" width="14" height="10" fill="#00ff66" stroke="#003311" />
    </svg>
  );
}
