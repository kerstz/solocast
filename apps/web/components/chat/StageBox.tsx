"use client";

import type { ChatConnectionStatus } from "../../lib/chat/chatClient";
import type { StageController } from "../../lib/stage/useStage";
import { STRINGS } from "../../lib/i18n/strings";
import { MicIcon } from "../desk/icons";

interface StageBoxProps {
  stage: StageController;
  chatStatus: ChatConnectionStatus;
  hasPseudo: boolean;
}

/**
 * Bloc « Monter sur scène ». Le bouton n'est qu'une DEMANDE (stage:request).
 * Le passage en antenne est décidé par le serveur (stage:granted) : jamais par ce composant.
 */
export function StageBox({ stage, chatStatus, hasPseudo }: StageBoxProps) {
  const { state } = stage;
  const onAir = state.phase === "on_air";
  const idle = state.phase === "idle" || state.phase === "error";
  const busy = !idle && !onAir;

  const disabled = busy || (idle && (!hasPseudo || chatStatus !== "open"));

  const label = onAir
    ? STRINGS.stage.leave
    : state.phase === "requesting"
      ? STRINGS.stage.requested
      : busy
        ? STRINGS.stage.busy
        : STRINGS.stage.request;

  const handleClick = (): void => {
    if (onAir) stage.leave();
    else if (idle) {
      stage.request();
    }
  };

  let status: string | null = null;
  let tone: "error" | undefined;
  switch (state.phase) {
    case "requesting":
      status = STRINGS.stage.requested;
      break;
    case "minting":
      status = STRINGS.stage.mintingStatus;
      break;
    case "connecting":
      status = STRINGS.stage.connectingStatus;
      break;
    case "publishing":
      status = STRINGS.stage.publishingStatus;
      break;
    case "on_air":
      status = STRINGS.stage.onAirStatus;
      break;
    case "stopping":
      status = STRINGS.stage.stoppingStatus;
      break;
    case "error":
      status = STRINGS.stage.errors[state.reason];
      tone = "error";
      break;
    case "idle":
      if (!hasPseudo) status = STRINGS.stage.loginHint;
      else if (chatStatus !== "open") status = STRINGS.stage.chatOffline;
      break;
  }

  return (
    <section className="stage-box" aria-labelledby="stage-title">
      <p>
        <strong id="stage-title">{STRINGS.stage.title}</strong> : {STRINGS.stage.intro}
      </p>
      <button
        type="button"
        className="btn96 btn96-stage"
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={onAir ? true : undefined}
        aria-describedby="stage-status"
      >
        <MicIcon />
        {label}
      </button>
      <p id="stage-status" className="stage-status" role="status" data-tone={tone}>
        {status}
      </p>
      {state.phase === "error" ? (
        <button type="button" className="btn96" onClick={stage.dismiss} style={{ marginTop: 6 }}>
          {STRINGS.stage.dismiss}
        </button>
      ) : null}
    </section>
  );
}
