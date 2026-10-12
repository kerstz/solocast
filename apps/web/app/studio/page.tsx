import type { Metadata } from "next";
import { StudioScreen } from "../../components/studio/StudioScreen";
import { STRINGS } from "../../lib/i18n/strings";

export const metadata: Metadata = { title: STRINGS.page.studioTitle };

/** /studio : clé (POST /api/studio/unlock) puis panneau de contrôle, une seule page. */
export default function StudioPage() {
  return <StudioScreen />;
}
