import { useId, type ReactNode } from "react";

interface StudioSectionProps {
  title: string;
  /** Badge court à droite du titre (ex. « non persisté »). */
  badge?: string;
  children: ReactNode;
}

/** Bloc titré du panneau studio : un titre de niveau 2 relié à sa région. */
export function StudioSection({ title, badge, children }: StudioSectionProps) {
  const titleId = useId();
  return (
    <section className="studio-section" aria-labelledby={titleId}>
      <div className="studio-section-head">
        <h2 id={titleId} className="studio-heading">
          {title}
        </h2>
        {badge ? <span className="studio-badge">{badge}</span> : null}
      </div>
      {children}
    </section>
  );
}
