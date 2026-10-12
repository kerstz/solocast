"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage } from "@solocast/shared";
import { STRINGS } from "../../lib/i18n/strings";
import { LinkifiedText } from "./LinkifiedText";
import { StreamerStar } from "../desk/icons";

/** Distance (px) sous laquelle on considère être « en bas » : auto-scroll actif. */
const STICK_THRESHOLD_PX = 40;
const DEFAULT_NICK_COLOR = "#0000cc";

interface ChatMessageListProps {
  messages: readonly ChatMessage[];
}

/**
 * Liste de messages : auto-scroll tant que l'utilisateur est en bas,
 * sinon compteur « nouveaux messages ». Zone focusable au clavier (scroll ↑↓ PgUp PgDn).
 */
export function ChatMessageList({ messages }: ChatMessageListProps) {
  const logRef = useRef<HTMLOListElement>(null);
  const stuckRef = useRef(true);
  const lastCountRef = useRef(0);
  const [unseen, setUnseen] = useState(0);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const added = messages.length - lastCountRef.current;
    lastCountRef.current = messages.length;
    if (stuckRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [messages]);

  const onScroll = (): void => {
    const el = logRef.current;
    if (!el) return;
    const stuck = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    stuckRef.current = stuck;
    if (stuck) setUnseen(0);
  };

  const jumpToLatest = (): void => {
    const el = logRef.current;
    if (!el) return;
    stuckRef.current = true;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  };

  return (
    <>
      <ol
        ref={logRef}
        role="log"
        aria-label={STRINGS.chat.log}
        tabIndex={0}
        className="chat-log"
        onScroll={onScroll}
      >
        {messages.length === 0 ? (
          <li className="chat-system">{STRINGS.chat.empty}</li>
        ) : (
          messages.map((m) => (
            <li key={m.id} className="chat-line">
              <time className="chat-time" dateTime={new Date(m.ts).toISOString()}>
                [{STRINGS.chat.sentAt(m.ts)}]
              </time>{" "}
              {m.isStreamer ? (
                <span className="badge-streamer">
                  <StreamerStar />
                  {STRINGS.chat.streamerBadge}
                </span>
              ) : null}{" "}
              <span className="chat-nick" style={{ color: m.color ?? DEFAULT_NICK_COLOR }}>
                {m.pseudo}
              </span>
              <span className="chat-colon">: </span>
              <LinkifiedText text={m.text} />
            </li>
          ))
        )}
      </ol>
      {unseen > 0 ? (
        <button type="button" className="btn96 chat-jump" onClick={jumpToLatest}>
          {STRINGS.chat.newMessages} ({unseen})
        </button>
      ) : null}
    </>
  );
}
