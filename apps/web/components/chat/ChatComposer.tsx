"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { CHAT_MESSAGE_MAX_LENGTH } from "@solocast/shared";
import { STRINGS } from "../../lib/i18n/strings";
import type { ChatNotice } from "../../lib/chat/useChat";

/** Pause après une notice de rate-limit (fenêtre serveur 3 msg / 2 s). */
export const RATE_LIMIT_COOLDOWN_MS = 2000;

interface ChatComposerProps {
  disabled: boolean;
  notice: ChatNotice | null;
  onSend: (text: string) => boolean;
}

/** Saisie du chat. Feedback visuel du rate-limit via system:notice (annoncé en role=status). */
export function ChatComposer({ disabled, notice, onSend }: ChatComposerProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [coolingDown, setCoolingDown] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (notice === null) return;
    setCoolingDown(true);
    const id = setTimeout(() => {
      setCoolingDown(false);
    }, RATE_LIMIT_COOLDOWN_MS);
    return () => {
      clearTimeout(id);
    };
  }, [notice]);

  const blocked = disabled || coolingDown;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || blocked) return;
    if (onSend(text)) {
      setDraft("");
      setLocalError(null);
    } else {
      setLocalError(STRINGS.chat.notSent);
    }
  };

  const feedback = localError ?? notice?.message ?? null;

  return (
    <>
      <form className="chat-composer" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor={inputId}>
          {STRINGS.chat.inputLabel}
        </label>
        <input
          id={inputId}
          className="field"
          type="text"
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          autoComplete="off"
          spellCheck
          placeholder={STRINGS.chat.placeholder}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <button type="submit" className="btn96 btn96-primary" disabled={blocked}>
          {STRINGS.chat.send}
        </button>
      </form>
      <p className="chat-notice" role="status" data-tone={feedback ? "warn" : undefined}>
        {feedback}
      </p>
    </>
  );
}
