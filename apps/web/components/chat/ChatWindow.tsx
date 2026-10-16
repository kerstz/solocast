"use client";

import Link from "next/link";
import type { ReportReason } from "@solocast/shared";
import type { ChatFeed } from "../../lib/chat/useChat";
import type { ChatConnectionStatus } from "../../lib/chat/chatClient";
import { STRINGS } from "../../lib/i18n/strings";
import { ChatGlyph } from "../desk/icons";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";

export interface ChatViewer {
  pseudo: string;
  /** Identifiant de session : exclut ses propres messages du signalement. */
  viewerId?: string;
}

interface ChatWindowProps {
  feed: ChatFeed;
  /** null tant que le viewer n'a pas choisi de pseudo : pas de connexion chat. */
  viewer: ChatViewer | null;
  /** Studio : lecture seule (pas de saisie, pas d'invite pseudo). La modération passe par la scène. */
  readOnly?: boolean;
  /** Signalement d'un message (POST /api/report). Absent : pas de bouton « Report ». */
  onReport?: (messageId: string, reason: ReportReason) => Promise<void>;
}

function statusLine(status: ChatConnectionStatus): string | null {
  switch (status) {
    case "connecting":
      return STRINGS.chat.connecting;
    case "reconnecting":
      return STRINGS.chat.reconnecting;
    case "closed":
      return STRINGS.chat.closed;
    case "open":
    case "idle":
      return null;
  }
}

/** Fenêtre chat : titre rouge, liste (sunken), saisie, notes slow-mode. */
export function ChatWindow({ feed, viewer, readOnly = false, onReport }: ChatWindowProps) {
  const online = feed.presence?.count ?? null;
  // Une fin définitive dit pourquoi (salon plein, ban, flood) plutôt que « chat indisponible ».
  const terminalLine = feed.terminated === null ? null : STRINGS.chat.terminated[feed.terminated];
  const line = viewer || readOnly ? (terminalLine ?? statusLine(feed.status)) : null;
  const canWrite = viewer !== null && feed.status === "open";

  return (
    <section className="win chat-window" aria-labelledby="chat-title">
      <div className="chat-titlebar">
        <ChatGlyph />
        <h2 id="chat-title" className="chat-title">
          {STRINGS.chat.title}
        </h2>
        {online !== null ? <span className="count">{STRINGS.chat.online(online)}</span> : null}
      </div>

      <div className="bevel-in chat-log-wrap" style={{ margin: 5 }}>
        <ChatMessageList
          messages={feed.messages}
          {...(onReport && viewer ? { onReport } : {})}
          selfId={viewer?.viewerId ?? null}
        />
      </div>

      {line ? (
        <p className="chat-notice" role="status">
          {line}
        </p>
      ) : null}

      {readOnly ? (
        <p className="chat-footnote">{STRINGS.studio.chatReadOnly}</p>
      ) : viewer ? (
        <ChatComposer
          disabled={!canWrite}
          notice={feed.notice}
          onSend={(text) => feed.client.sendChat(text)}
        />
      ) : (
        <p className="chat-footnote" style={{ fontSize: 12, margin: "0 7px 8px" }}>
          {STRINGS.chat.prompt} <Link href="/">{STRINGS.chat.promptLink}</Link>
        </p>
      )}

      {!readOnly && viewer ? (
        <p className="chat-footnote">
          {STRINGS.chat.slowMode} · {STRINGS.chat.connectedAs} <strong>{viewer.pseudo}</strong>
        </p>
      ) : null}
    </section>
  );
}
