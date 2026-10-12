import type { Metadata } from "next";
import { JoinWindow } from "../components/join/JoinWindow";
import { STRINGS } from "../lib/i18n/strings";

export const metadata: Metadata = { title: STRINGS.page.joinTitle };

export default function HomePage() {
  return <JoinWindow />;
}
