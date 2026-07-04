'use client';

import { useState, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

// Controlled tab shell. All panels are rendered up-front and inactive ones are
// hidden (not unmounted) so server-action forms keep their state across tab
// switches. The active panel replays the entrance animation.
export default function Tabs({
  tabs,
  initial
}: {
  tabs: TabDef[];
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`relative -mb-px flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                on ? 'text-t1' : 'text-t4 hover:text-t2'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    on
                      ? 'bg-navy/20 text-navy'
                      : 'bg-line text-t4'
                  }`}
                >
                  {t.count}
                </span>
              )}
              {on && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-navy" />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div key={t.id} className={t.id === active ? 'fade' : 'hidden'}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
