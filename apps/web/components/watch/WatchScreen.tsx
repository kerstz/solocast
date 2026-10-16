"use client";

import Link from "next/link";
import { MAX_SPEAKERS } from "@solocast/shared";
import { getViewerBackend } from "../../lib/backend";
import { useChat } from "../../lib/chat/useChat";
import { getStageMedia } from "../../lib/stage";
import { useStage } from "../../lib/stage/useStage";
import { mutesStreamAudio } from "../../lib/stage/stageMachine";
import { useSession } from "../../lib/session/SessionProvider";
import { getWatchRoom } from "../../lib/watch";
import { useWatch } from "../../lib/watch/useWatch";
import { STRINGS } from "../../lib/i18n/strings";
import { Player } from "../player/Player";
import { ChatWindow } from "../chat/ChatWindow";
import { StageBox } from "../chat/StageBox";
import { EyeGlyph, ScreenGlyph } from "../desk/icons";
import { MenuBar, TitleBar } from "../desk/WindowChrome";
import { Taskbar } from "../desk/Taskbar";

/** /watch: WebRTC player + chat + stage request. */
export function WatchScreen() {
  const session = useSession();
  const backend = getViewerBackend();
  const media = getStageMedia();
  const pseudo = session.me?.pseudo ?? null;
  const viewerId = session.me?.viewerId;
  const viewer = pseudo ? { pseudo, ...(viewerId === undefined ? {} : { viewerId }) } : null;

  const feed = useChat(backend, session.hasPseudo);
  const stage = useStage(feed.client, backend, media);
  const onAir = stage.state.phase === "on_air";
  const muted = mutesStreamAudio(stage.state);

  // The session is only joined once the viewer has a username (same gate as the chat).
  const watch = useWatch(backend, getWatchRoom(), session.hasPseudo);

  const speakers = feed.presence?.speakers ?? null;
  const viewers = feed.presence?.count ?? null;
  // One line per real session state: nothing claims "offline" while the session is still joining.
  const statusText = STRINGS.status[watch.status];
  // Same rule for the window title: "LIVE" only once the track is actually flowing.
  const windowTitle = STRINGS.window.watchTitle(watch.status === "live");

  return (
    <div className="desk">
      <main className="desk-main">
        <section className="win window-frame" aria-label={windowTitle}>
          <TitleBar title={windowTitle} closeHref="/" glyph={<ScreenGlyph />} />
          <MenuBar />

          <div className="watch-body">
            <div className="watch-left">
              <Player watch={watch} muted={muted} viewers={viewers} />

              {onAir ? (
                <div className="stage-banner" role="status">
                  <EyeGlyph />
                  <span>
                    <span className="blink">{STRINGS.player.onAirBanner}</span>{" "}
                    {STRINGS.player.onAirHint}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="watch-right">
              <ChatWindow
                feed={feed}
                viewer={viewer}
                onReport={(messageId, reason) => backend.reportMessage({ messageId, reason })}
              />
              <StageBox stage={stage} chatStatus={feed.status} hasPseudo={session.hasPseudo} />
              <div className="room-box" aria-label={STRINGS.room.title}>
                <div className="room-title">{STRINGS.room.title}</div>
                <dl className="room-stats">
                  <dt>{STRINGS.room.viewersLabel}</dt>
                  <dd className="counter">
                    {viewers === null
                      ? "——"
                      : `${String(viewers).padStart(2, "0")}/${String(feed.presence?.maxViewers ?? 0)}`}
                  </dd>
                  <dt>{STRINGS.room.chatLabel}</dt>
                  <dd className="counter">{STRINGS.room.chatStatus[feed.status]}</dd>
                </dl>
              </div>
            </div>
          </div>

          <div className="statusbar">
            <div className="grow">{statusText}</div>
            <div>
              <Link href="/privacy">{STRINGS.privacy.link}</Link>
            </div>
            <div>{STRINGS.status.viewers(viewers)}</div>
            <div>{STRINGS.status.speakers(speakers, MAX_SPEAKERS)}</div>
          </div>
        </section>
      </main>

      <Taskbar>
        <span className="task active">
          <ScreenGlyph size={14} />
          {STRINGS.player.title}
        </span>
        <span className="task">{STRINGS.chat.title}</span>
      </Taskbar>
    </div>
  );
}
