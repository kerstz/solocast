"use client";

import { useEffect, useReducer, useState } from "react";
import type { ChatMessage, PresenceUpdate } from "@solocast/shared";
import type { ViewerBackend } from "../backend/types";
import { STRINGS } from "../i18n/strings";
import { ChatClient, type ChatConnectionStatus, type TerminalReason } from "./chatClient";

/** Plafond côté client : le DOM ne garde que les derniers messages (cf. chat:history max 200). */
export const MAX_CLIENT_MESSAGES = 300;

export interface ChatNotice {
  id: number;
  message: string;
}

export interface ChatFeedState {
  status: ChatConnectionStatus;
  messages: ChatMessage[];
  presence: PresenceUpdate | null;
  /** Horodatage (ms) de la dernière présence reçue : affiché « il y a N s » côté studio. */
  presenceAt: number | null;
  notice: ChatNotice | null;
  /** Cause d'un arrêt définitif (ban, flood, session refusée, salon plein). */
  terminated: TerminalReason | null;
}

type ChatAction =
  | { type: "status"; status: ChatConnectionStatus }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "presence"; presence: PresenceUpdate; at: number }
  | { type: "notice"; message: string }
  | { type: "terminated"; reason: TerminalReason }
  | { type: "dismissNotice" };

export const INITIAL_CHAT_FEED: ChatFeedState = {
  status: "idle",
  messages: [],
  presence: null,
  presenceAt: null,
  notice: null,
  terminated: null,
};

let noticeCounter = 0;

export function chatFeedReducer(state: ChatFeedState, action: ChatAction): ChatFeedState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "history":
      return { ...state, messages: action.messages.slice(-MAX_CLIENT_MESSAGES) };
    case "message": {
      // Dédoublonnage par id (un message peut arriver deux fois après une reconnexion).
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      const next = [...state.messages, action.message];
      return { ...state, messages: next.slice(-MAX_CLIENT_MESSAGES) };
    }
    case "presence":
      return { ...state, presence: action.presence, presenceAt: action.at };
    case "notice":
      noticeCounter += 1;
      return { ...state, notice: { id: noticeCounter, message: action.message } };
    case "terminated":
      noticeCounter += 1;
      return {
        ...state,
        terminated: action.reason,
        notice: { id: noticeCounter, message: STRINGS.chat.terminated[action.reason] },
      };
    case "dismissNotice":
      return { ...state, notice: null };
  }
}

export interface ChatFeed extends ChatFeedState {
  client: ChatClient;
  dismissNotice: () => void;
}

/** Connecte le chat quand `enabled` (viewer identifié). Aucune connexion sinon. */
export function useChat(backend: ViewerBackend, enabled: boolean): ChatFeed {
  const [client] = useState(() => new ChatClient({ createTransport: () => backend.openChat() }));
  const [state, dispatch] = useReducer(chatFeedReducer, INITIAL_CHAT_FEED);

  useEffect(
    () =>
      client.subscribe((event) => {
        switch (event.kind) {
          case "status":
            dispatch({ type: "status", status: event.status });
            break;
          case "history":
            dispatch({ type: "history", messages: event.messages });
            break;
          case "message":
            dispatch({ type: "message", message: event.message });
            break;
          case "presence":
            dispatch({ type: "presence", presence: event.presence, at: Date.now() });
            break;
          case "notice":
            dispatch({ type: "notice", message: event.message });
            break;
          case "terminated":
            // Fermeture définitive : l'utilisateur doit comprendre pourquoi le chat s'arrête.
            dispatch({ type: "terminated", reason: event.reason });
            break;
          case "stageGranted":
          case "stageRevoked":
          case "stageRequest":
            // Géré par useStage (viewer) ou useStudio (streameur) : abonnements séparés.
            break;
        }
      }),
    [client],
  );

  useEffect(() => {
    if (!enabled) return;
    client.connect();
    return () => {
      client.close();
    };
  }, [client, enabled]);

  return {
    ...state,
    client,
    dismissNotice: () => {
      dispatch({ type: "dismissNotice" });
    },
  };
}
