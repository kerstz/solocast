import type { ReactNode } from "react";

/** Groupe de routes du lecteur viewer (/watch). Pas de chrome propre : la fenêtre est dans la page. */
export default function ViewerLayout({ children }: { children: ReactNode }) {
  return children;
}
