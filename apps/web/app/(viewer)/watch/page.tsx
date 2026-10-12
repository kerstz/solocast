import type { Metadata } from "next";
import { WatchScreen } from "../../../components/watch/WatchScreen";
import { STRINGS } from "../../../lib/i18n/strings";

export const metadata: Metadata = { title: STRINGS.page.watchTitle };

export default function WatchPage() {
  return <WatchScreen />;
}
