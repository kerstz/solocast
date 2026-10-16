"use client";

import { REPORT_REASONS, type ReportReason } from "@solocast/shared";
import { useState } from "react";
import { pickErrorMessage } from "../../lib/backend/errors";
import { STRINGS } from "../../lib/i18n/strings";

type Phase = "idle" | "choosing" | "sending" | "done";

interface ReportControlProps {
  pseudo: string;
  onReport: (reason: ReportReason) => Promise<void>;
}

/** Bouton « Report » discret d'un message : choix d'une raison, envoi, confirmation. */
export function ReportControl({ pseudo, onReport }: ReportControlProps) {
  const R = STRINGS.chat.report;
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const send = (reason: ReportReason): void => {
    setPhase("sending");
    setError(null);
    onReport(reason)
      .then(() => {
        setPhase("done");
      })
      .catch((err: unknown) => {
        setError(pickErrorMessage(R.errors, err, STRINGS.errors.generic));
        setPhase("choosing");
      });
  };

  if (phase === "done") {
    return (
      <span className="chat-report" role="status">
        {R.done}
      </span>
    );
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        className="chat-report-btn"
        aria-label={R.buttonLabel(pseudo)}
        onClick={() => {
          setPhase("choosing");
        }}
      >
        {R.button}
      </button>
    );
  }

  return (
    <span className="chat-report" role="group" aria-label={R.choose}>
      {REPORT_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          className="chat-report-btn"
          disabled={phase === "sending"}
          onClick={() => {
            send(reason);
          }}
        >
          {R.reasons[reason]}
        </button>
      ))}
      <button
        type="button"
        className="chat-report-btn"
        disabled={phase === "sending"}
        onClick={() => {
          setPhase("idle");
          setError(null);
        }}
      >
        {R.cancel}
      </button>
      {error !== null ? (
        <span className="error-text" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
