"use client";

import { useState } from "react";
import { canActOn, canGrant, type SceneEntry } from "../../lib/studio/scene";
import type { StudioController } from "../../lib/studio/useStudio";
import { STRINGS } from "../../lib/i18n/strings";
import { StudioSection } from "./StudioSection";

interface ScenePanelProps {
  studio: StudioController;
}

/**
 * Scène : demandes de parole (file serveur) puis speakers accordés par ce studio.
 * Donner n'est qu'une demande (POST /api/stage/grant) : rien n'entre dans la liste avant 204.
 */
export function ScenePanel({ studio }: ScenePanelProps) {
  const { scene, capReached } = studio;
  const [confirmBanId, setConfirmBanId] = useState<string | null>(null);
  const S = STRINGS.studio.scene;

  const pseudoOf = (viewerId: string): string =>
    scene.requests.find((r) => r.viewerId === viewerId)?.pseudo ??
    scene.speakers.find((s) => s.viewerId === viewerId)?.pseudo ??
    "";

  const failure = scene.failure;
  const failureText = failure
    ? S.failed(S.actions[failure.action], pseudoOf(failure.viewerId))
    : null;

  const renderBan = (entry: SceneEntry) =>
    confirmBanId === entry.viewerId ? (
      <>
        <button
          type="button"
          className="btn96 studio-btn-danger"
          disabled={!canActOn(scene, entry.viewerId)}
          aria-label={`${S.banConfirm} ${entry.pseudo}`}
          onClick={() => {
            setConfirmBanId(null);
            studio.ban(entry.viewerId);
          }}
        >
          {S.banConfirm}
        </button>
        <button
          type="button"
          className="btn96"
          onClick={() => {
            setConfirmBanId(null);
          }}
        >
          {S.cancel}
        </button>
      </>
    ) : (
      <button
        type="button"
        className="btn96 studio-btn-danger"
        disabled={!canActOn(scene, entry.viewerId)}
        aria-label={`${S.ban} ${entry.pseudo}`}
        onClick={() => {
          setConfirmBanId(entry.viewerId);
        }}
      >
        {S.ban}
      </button>
    );

  return (
    <StudioSection title={S.title}>
      <div className="studio-scene-grid">
        <div>
          <h3 className="studio-subhead">{S.requests}</h3>
          {scene.requests.length === 0 ? (
            <p className="studio-empty">{S.requestsEmpty}</p>
          ) : (
            <ol className="studio-list" aria-label={S.requests}>
              {scene.requests.map((entry) => (
                <li key={entry.viewerId} className="studio-row">
                  <span className="studio-pseudo">{entry.pseudo}</span>
                  <span className="studio-row-actions">
                    <button
                      type="button"
                      className="btn96 btn96-stage"
                      disabled={!canGrant(scene, entry.viewerId, capReached)}
                      aria-label={`${S.grant} ${entry.pseudo}`}
                      onClick={() => {
                        studio.grant(entry.viewerId);
                      }}
                    >
                      {S.grant}
                    </button>
                    {renderBan(entry)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h3 className="studio-subhead">{S.onStage}</h3>
          {scene.speakers.length === 0 ? (
            <p className="studio-empty">{S.onStageEmpty}</p>
          ) : (
            <ul className="studio-list" aria-label={S.onStage}>
              {scene.speakers.map((entry) => (
                <li key={entry.viewerId} className="studio-row">
                  <span className="studio-pseudo">{entry.pseudo}</span>
                  <span className="studio-row-actions">
                    <button
                      type="button"
                      className="btn96"
                      disabled={!canActOn(scene, entry.viewerId)}
                      aria-label={`${S.revoke} ${entry.pseudo}`}
                      onClick={() => {
                        studio.revoke(entry.viewerId);
                      }}
                    >
                      {S.revoke}
                    </button>
                    {renderBan(entry)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {capReached ? <p className="studio-hint">{S.capReached}</p> : null}

      {failureText ? (
        <p className="studio-alert" role="alert">
          <span>{failureText}</span>{" "}
          <button type="button" className="btn96" onClick={studio.dismissFailure}>
            {S.dismiss}
          </button>
        </p>
      ) : null}
    </StudioSection>
  );
}
