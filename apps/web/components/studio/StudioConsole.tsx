"use client";

import { useRef } from "react";
import { getViewerBackend } from "../../lib/backend";
import { getBroadcaster } from "../../lib/studio/broadcaster";
import { useAppControl } from "../../lib/studio/useAppControl";
import { useStudio } from "../../lib/studio/useStudio";
import { STRINGS } from "../../lib/i18n/strings";
import { ChatWindow } from "../chat/ChatWindow";
import { ScreenGlyph } from "../desk/icons";
import { MenuBar, TitleBar } from "../desk/WindowChrome";
import { Taskbar } from "../desk/Taskbar";
import { AppPanel } from "./AppPanel";
import { BroadcastPanel } from "./BroadcastPanel";
import { CountersPanel } from "./CountersPanel";
import { ScenePanel } from "./ScenePanel";
import { SettingsPanel } from "./SettingsPanel";

/**
 * Panneau de contrôle du streameur : une colonne, zéro scroll de page au desktop.
 * Seul le chat garde sa propre zone de défilement.
 */
export function StudioConsole() {
  const previewRef = useRef<HTMLVideoElement>(null);
  const studio = useStudio(getViewerBackend(), getBroadcaster(), previewRef);
  const app = useAppControl(getViewerBackend());

  return (
    <div className="desk studio-desk">
      <main className="desk-main studio-main" aria-label={STRINGS.studio.pageLabel}>
        <section className="win studio-window" aria-label={STRINGS.window.studioTitle}>
          <TitleBar title={STRINGS.window.studioTitle} closeHref="/" glyph={<ScreenGlyph />} />
          <MenuBar />
          <div className="studio-column">
            <AppPanel app={app} />
            <BroadcastPanel
              studio={studio}
              previewRef={previewRef}
              obsAvailable={app.status === null || app.status.ingest}
            />
            <SettingsPanel
              settings={studio.settings}
              notice={studio.settingNotice}
              onChange={studio.setSetting}
            />
            <CountersPanel
              presence={studio.presence}
              presenceAt={studio.presenceAt}
              now={studio.now}
              publishing={studio.phase === "live"}
            />
            <ScenePanel studio={studio} />
            <div className="studio-chat">
              <ChatWindow feed={studio.chat} viewer={null} readOnly />
            </div>
          </div>
        </section>
      </main>
      <Taskbar>
        <span className="task active">
          <ScreenGlyph size={14} />
          {STRINGS.studio.taskLabel}
        </span>
      </Taskbar>
    </div>
  );
}
