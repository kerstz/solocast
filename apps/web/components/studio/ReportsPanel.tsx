"use client";

import { getViewerBackend } from "../../lib/backend";
import { STRINGS } from "../../lib/i18n/strings";
import { useReports } from "../../lib/studio/useReports";
import { StudioSection } from "./StudioSection";

/**
 * Signalements des spectateurs (file bornée côté serveur, 7 jours). « Dismiss » n'est qu'un
 * classement : pour bloquer quelqu'un, le bannissement du panneau Stage existe déjà.
 */
export function ReportsPanel() {
  const S = STRINGS.studio.reports;
  const { reports, failed, dismiss } = useReports(getViewerBackend());

  return (
    <StudioSection title={S.title}>
      <p className="studio-hint">{S.intro}</p>
      {reports.length === 0 ? (
        <p className="studio-empty">{S.empty}</p>
      ) : (
        <ul className="studio-list" aria-label={S.list}>
          {reports.map((report) => {
            const pseudo = report.message?.pseudo ?? null;
            return (
              <li key={report.id} className="studio-row">
                <span>
                  <strong>{S.reasons[report.reason]}</strong> · {S.reportedBy} {S.at(report.ts)}
                  <br />
                  {report.message ? (
                    <>
                      <span className="studio-pseudo">{report.message.pseudo}</span>
                      {": "}
                      {report.message.text}
                    </>
                  ) : (
                    S.messageGone
                  )}
                  {report.details !== null ? (
                    <>
                      <br />
                      {S.details}: {report.details}
                    </>
                  ) : null}
                </span>
                <span className="studio-row-actions">
                  <button
                    type="button"
                    className="btn96"
                    aria-label={S.dismissLabel(S.reasons[report.reason], pseudo)}
                    onClick={() => {
                      dismiss(report.id);
                    }}
                  >
                    {S.dismiss}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {failed ? (
        <p className="studio-alert" role="alert">
          {S.failed}
        </p>
      ) : null}
    </StudioSection>
  );
}
