import type { ReactNode } from 'react';
import { h1, subtitle as subtitleClass, eyebrow as eyebrowClass } from './theme';

// Standard page header: optional mono eyebrow, bold title, muted subtitle, and
// an optional right-aligned action slot. Matches the dashboard header.
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  action
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className={`mb-1 ${eyebrowClass}`}>{eyebrow}</div> : null}
        <h1 className={h1}>{title}</h1>
        {subtitle ? <p className={subtitleClass}>{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}
