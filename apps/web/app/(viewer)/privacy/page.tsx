import type { Metadata } from "next";
import { PrivacyScreen } from "../../../components/privacy/PrivacyScreen";
import { STRINGS } from "../../../lib/i18n/strings";

export const metadata: Metadata = { title: STRINGS.page.privacyTitle };

/** /privacy : page statique (compatible `output: export`), liée depuis l'accueil et le lecteur. */
export default function PrivacyPage() {
  return <PrivacyScreen />;
}
