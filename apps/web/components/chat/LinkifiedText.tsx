import { Fragment } from "react";
import { linkify } from "../../lib/chat/linkify";

/**
 * Rendu texte échappé (React) : jamais de HTML interprété.
 * Seuls les liens http(s) deviennent <a> avec rel="noopener noreferrer".
 */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((segment, index) =>
        segment.kind === "link" ? (
          <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer">
            {segment.value}
          </a>
        ) : (
          <Fragment key={index}>{segment.value}</Fragment>
        ),
      )}
    </>
  );
}
