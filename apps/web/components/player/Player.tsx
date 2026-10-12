"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeReceived,
  isQualityChoice,
  qualityLabel,
  QUALITY_CHOICES,
} from "../../lib/player/quality";
import { SCREEN_PRESETS, screenStyle } from "../../lib/player/screen";
import type { WatchFeed } from "../../lib/watch/useWatch";
import { STRINGS } from "../../lib/i18n/strings";
import { LiveVideo } from "./LiveVideo";
import { TimeLcd } from "./TimeLcd";

export interface PlayerProps {
  watch: WatchFeed;
  /** Stream audio muted while the viewer is on air (anti-echo). */
  muted: boolean;
  viewers: number | null;
}

/** Equalizer bar offsets (decorative, fixed distinct values). */
const EQ_DELAYS = [0, 0.15, 0.3, 0.08, 0.22, 0.35, 0.12, 0.28];

/** Winamp-style player: LCD, SMPTE screen, overlays, transport, equalizer, volume. */
export function Player({ watch, muted, viewers }: PlayerProps) {
  const [playing, setPlaying] = useState(true);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);

  const { status, received, quality, screen, volume } = watch;
  const isLive = status === "live";

  useEffect(() => {
    if (isLive && playing && startedAt === null) setStartedAt(Date.now());
    if (!isLive) setStartedAt(null);
  }, [isLive, playing, startedAt]);

  // Stream audio: off while on stage or while the player is paused.
  useEffect(() => {
    watch.setMuted(muted || !playing);
  }, [watch, muted, playing]);

  useEffect(() => {
    const onChange = (): void => {
      setFullscreen(document.fullscreenElement === screenRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const element = screenRef.current;
    if (!element) return;
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    void element.requestFullscreen().catch(() => undefined);
  }, []);

  const receivedLabel = describeReceived(received);
  const streamLabel = receivedLabel
    ? `${receivedLabel}${quality === "auto" ? " (auto)" : ""}`
    : "—";

  return (
    <>
      <div className="player">
        <div className="player-strip">
          <span style={{ letterSpacing: 1 }}>S O L O C A S T &nbsp; P L A Y E R</span>
          <span className="spacer" />
          <span style={{ opacity: 0.8 }}>{STRINGS.player.channel}</span>
        </div>

        <div className="marquee-wrap lcd" role="presentation">
          <span className="marquee">{STRINGS.player.marquee(isLive, viewers)}</span>
        </div>

        <div
          ref={screenRef}
          className="screen"
          role="region"
          aria-label={STRINGS.player.region}
          style={fullscreen ? undefined : screenStyle(screen)}
        >
          <div className="smpte" aria-hidden="true">
            <span style={{ background: "#bdbdbd" }} />
            <span style={{ background: "#bdbd00" }} />
            <span style={{ background: "#00bdbd" }} />
            <span style={{ background: "#00bd00" }} />
            <span style={{ background: "#bd00bd" }} />
            <span style={{ background: "#bd0000" }} />
            <span style={{ background: "#0000bd" }} />
          </div>
          <div className="smpte-lower" aria-hidden="true">
            <span style={{ background: "#0000bd" }} />
            <span style={{ background: "#131313" }} />
            <span style={{ background: "#bd00bd" }} />
            <span style={{ background: "#131313" }} />
            <span style={{ background: "#00bdbd" }} />
            <span style={{ background: "#131313" }} />
            <span style={{ background: "#1a1a1a" }} />
          </div>

          <LiveVideo
            attach={watch.attachVideo}
            playing={playing}
            onAutoplayBlocked={() => {
              setAutoplayBlocked(true);
              setPlaying(false);
            }}
          />

          <div className="scanlines" aria-hidden="true" />

          {isLive ? (
            <div className="overlay rec">
              <span className="blink">{STRINGS.player.rec}</span>
            </div>
          ) : (
            <div className="overlay offline" role="status">
              {status === "connecting" ? STRINGS.player.loading : STRINGS.player.offline}
            </div>
          )}

          {viewers !== null ? (
            <div className="overlay viewers">
              <svg width="13" height="11" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
                <ellipse cx="8" cy="6" rx="7" ry="4.5" fill="none" stroke="#fff" />
                <circle cx="8" cy="6" r="2" fill="#fff" />
              </svg>
              {STRINGS.player.viewers(viewers)}
            </div>
          ) : null}

          <div className="overlay bottom-left">{streamLabel}</div>
          <div className="overlay bottom-right">{STRINGS.player.transport}</div>

          {status === "waiting" ? (
            <div className="overlay-center" role="status">
              <p>{STRINGS.player.offlineTitle}</p>
              <p style={{ fontSize: 16 }}>{STRINGS.player.offlineHint}</p>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="overlay-center" role="alert">
              <p>
                {watch.fault === "room_full"
                  ? STRINGS.player.roomFullTitle
                  : STRINGS.player.errorTitle}
              </p>
              <p style={{ fontSize: 16 }}>
                {watch.fault === "room_full"
                  ? STRINGS.player.roomFullHint
                  : STRINGS.player.errorHint}
              </p>
            </div>
          ) : null}

          {autoplayBlocked && isLive ? (
            <div className="overlay-center" role="status">
              <p style={{ fontSize: 16 }}>{STRINGS.player.autoplayBlocked}</p>
            </div>
          ) : null}
        </div>

        <div className="transport-bar">
          <TimeLcd startedAt={startedAt} />
          <div className="transport-group" role="group" aria-label="Transport">
            <button
              type="button"
              className="btn96 btn96-transport"
              disabled
              aria-label={STRINGS.player.previous}
            >
              ⏮
            </button>
            <button
              type="button"
              className="btn96 btn96-transport play"
              aria-label={playing ? STRINGS.player.pause : STRINGS.player.play}
              onClick={() => {
                setAutoplayBlocked(false);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <button
              type="button"
              className="btn96 btn96-transport"
              aria-label={STRINGS.player.stop}
              onClick={() => {
                setPlaying(false);
              }}
            >
              ■
            </button>
            <button
              type="button"
              className="btn96 btn96-transport"
              disabled
              aria-label={STRINGS.player.next}
            >
              ⏭
            </button>
          </div>
          <div className={isLive && playing ? "eq" : "eq idle"} aria-hidden="true">
            {EQ_DELAYS.map((delay) => (
              <span
                key={delay}
                className="eq-bar"
                style={{ animationDelay: `${String(delay)}s` }}
              />
            ))}
          </div>
          <span className="spacer" />
          <label className="volume">
            {STRINGS.player.volume}
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => {
                watch.setVolume(Number(e.target.value) / 100);
              }}
              aria-label={STRINGS.player.volume}
            />
          </label>
        </div>
      </div>

      <div className="info-bar">
        <label>
          <strong>{STRINGS.player.quality}&nbsp;:</strong>
          <select
            value={quality}
            onChange={(e) => {
              const next = e.target.value;
              if (isQualityChoice(next)) watch.setQuality(next);
            }}
            aria-label={STRINGS.player.quality}
          >
            {QUALITY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {qualityLabel(choice)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <strong>{STRINGS.player.screen}&nbsp;:</strong>
          <select
            value={screen.id}
            onChange={(e) => {
              watch.setScreen(e.target.value);
            }}
            aria-label={STRINGS.player.screen}
          >
            {SCREEN_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn96" onClick={toggleFullscreen}>
          {fullscreen ? STRINGS.player.exitFullscreen : STRINGS.player.fullscreen}
        </button>
        <span className="field-note">
          {STRINGS.player.received}&nbsp;:{" "}
          <strong>{receivedLabel ?? STRINGS.player.receivedNone}</strong>
        </span>
      </div>
    </>
  );
}
