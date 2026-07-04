'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, RotateCcw, ChevronRight, Save } from 'lucide-react';
import { PERSONA_TEMPLATE_VARS } from '@/utils/dara/personas';
import {
  createPersona,
  updatePersona,
  deletePersona,
  togglePersonaActive,
  setPersonaIcon,
  restorePersonaDefaults
} from './actions';

export interface PersonaItem {
  id: string;
  displayName: string;
  systemPrompt: string;
  isActive: boolean;
  icon: string | null;
  usedIn: number;
}

const EMOJI_CHOICES = [
  '🔬', '⚖️', '📋', '🗂️', '🏢', '🔒',
  '🎯', '📊', '🛡️', '💼', '🧭', '⚙️',
  '📁', '🔎', '🧠', '✅', '📐', '💡'
];

// Deterministic icon + tint per persona (matches the prototype's semantic icons
// for the built-ins, with a neutral fallback for custom ones).
const ICONS: { match: string; emoji: string; tint: string }[] = [
  { match: 'technical', emoji: '🔬', tint: '59,110,240' },
  { match: 'contracting', emoji: '⚖️', tint: '16,185,129' },
  { match: 'past performance', emoji: '📋', tint: '124,58,237' },
  { match: 'management', emoji: '🗂️', tint: '245,158,11' },
  { match: 'risk', emoji: '🗂️', tint: '245,158,11' },
  { match: 'small business', emoji: '🏢', tint: '100,116,139' },
  { match: 'cyber', emoji: '🔒', tint: '239,68,68' },
  { match: 'security', emoji: '🔒', tint: '239,68,68' }
];
function iconFor(name: string) {
  const n = name.toLowerCase();
  return ICONS.find((i) => n.includes(i.match)) ?? { emoji: '◈', tint: '59,110,240' };
}
function preview(prompt: string) {
  return prompt
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 46);
}

export default function PersonaManager({ personas }: { personas: PersonaItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(
    personas[0]?.id ?? null
  );

  const selected = personas.find((p) => p.id === selectedId) ?? null;
  const [name, setName] = useState(selected?.displayName ?? '');
  const [prompt, setPrompt] = useState(selected?.systemPrompt ?? '');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load the editor when the selected persona (or its server data) changes.
  useEffect(() => {
    setName(selected?.displayName ?? '');
    setPrompt(selected?.systemPrompt ?? '');
    setIconPickerOpen(false);
  }, [selectedId, selected?.displayName, selected?.systemPrompt]);

  // Insert a template variable at the textarea's last cursor position.
  const insertVar = (v: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? prompt.length;
    const end = el?.selectionEnd ?? prompt.length;
    const next = prompt.slice(0, start) + v + prompt.slice(end);
    setPrompt(next);
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + v.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  // Keep selection valid after server refreshes (e.g. delete).
  useEffect(() => {
    if (selectedId && !personas.some((p) => p.id === selectedId)) {
      setSelectedId(personas[0]?.id ?? null);
    }
  }, [personas, selectedId]);

  const activeCount = personas.filter((p) => p.isActive).length;
  const dirty = selected
    ? name !== selected.displayName || prompt !== selected.systemPrompt
    : false;

  const refreshAfter = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  const onNew = () =>
    startTransition(async () => {
      const id = await createPersona();
      router.refresh();
      setSelectedId(id);
    });
  const onSave = () =>
    selected && refreshAfter(() => updatePersona(selected.id, name, prompt));
  const onDelete = () =>
    selected &&
    window.confirm(`Delete "${selected.displayName}"? This cannot be undone.`) &&
    refreshAfter(() => deletePersona(selected.id));
  const onDiscard = () => {
    if (selected) {
      setName(selected.displayName);
      setPrompt(selected.systemPrompt);
    }
  };

  return (
    <div className="flex h-full gap-5 fade">
      {/* Left: persona list */}
      <aside className="flex w-[330px] flex-shrink-0 flex-col overflow-hidden rounded-[10px] border border-line bg-surf">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <div>
            <div className="text-[14px] font-bold text-t1">Evaluator Personas</div>
            <div className="mt-0.5 font-mono text-[11px] text-t5">
              {activeCount} of {personas.length} active
            </div>
          </div>
          <button
            onClick={onNew}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg bg-navy px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
          {personas.map((p) => {
            const ic = iconFor(p.displayName);
            const emoji = p.icon || ic.emoji;
            const sel = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                  sel
                    ? 'border-navy/40 bg-navy/10'
                    : 'border-line bg-surf hover:bg-surf2'
                }`}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] text-[16px]"
                  style={{ background: `rgba(${ic.tint},0.15)` }}
                >
                  {emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        p.isActive ? 'bg-[#10b981]' : 'bg-line'
                      }`}
                    />
                    <span className="truncate text-[13px] font-semibold text-t1">
                      {p.displayName}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-t5">
                    {preview(p.systemPrompt) || 'No prompt yet'}
                  </span>
                </span>
                <ChevronRight
                  className={`h-4 w-4 flex-shrink-0 ${sel ? 'text-navy' : 'text-t5/40'}`}
                />
              </button>
            );
          })}
        </div>

        <div className="border-t border-line p-2.5">
          <button
            onClick={() => refreshAfter(() => restorePersonaDefaults())}
            disabled={pending}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2 text-[11px] text-t5 transition-colors hover:text-t3 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore defaults
          </button>
        </div>
      </aside>

      {/* Right: editor */}
      <section className="flex flex-1 flex-col overflow-y-auto rounded-[10px] border border-line bg-surf">
        {selected ? (
          <div className="flex flex-1 flex-col p-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-t5">
              Analysis
            </div>
            <div className="mt-1 flex items-start justify-between gap-4">
              <h1 className="text-2xl font-bold tracking-tight text-t1">
                {selected.displayName}
              </h1>
              <button
                onClick={onDelete}
                disabled={pending}
                className="inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-[#5a1f1f]/60 px-3 py-2 text-[13px] font-medium text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete persona
              </button>
            </div>

            {/* Template variables — click to insert at the cursor */}
            <div className="mt-5 rounded-lg border border-line bg-surf2 px-4 py-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                Template variables
              </div>
              <div className="flex flex-wrap gap-2">
                {PERSONA_TEMPLATE_VARS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => insertVar(v)}
                    title="Insert at cursor"
                    className="rounded border border-navy/20 bg-navy/10 px-2 py-0.5 font-mono text-[10px] text-navy transition-colors hover:border-navy/50 hover:bg-navy/20"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Display name + active toggle */}
            <div className="mt-5">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                Display name
              </label>
              <div className="flex items-center gap-3">
                {/* Icon picker */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIconPickerOpen((o) => !o)}
                    title="Change icon"
                    aria-label="Change persona icon"
                    className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-lg border border-line text-[18px] transition-colors hover:border-navy"
                    style={{
                      background: `rgba(${iconFor(selected.displayName).tint},0.15)`
                    }}
                  >
                    {selected.icon || iconFor(selected.displayName).emoji}
                  </button>
                  {iconPickerOpen && (
                    <div className="absolute left-0 top-[48px] z-20 grid w-[208px] grid-cols-6 gap-1 rounded-lg border border-line bg-surf p-2 shadow-lg">
                      {EMOJI_CHOICES.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            setIconPickerOpen(false);
                            refreshAfter(() => setPersonaIcon(selected.id, e));
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded text-[16px] transition-colors hover:bg-surf2"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1 rounded-lg border border-line bg-surf2 px-3.5 py-2.5 text-[13px] text-t1 outline-none transition-colors focus:border-navy"
                />
                <button
                  type="button"
                  role="switch"
                  aria-checked={selected.isActive}
                  onClick={() => refreshAfter(() => togglePersonaActive(selected.id))}
                  disabled={pending}
                  title={
                    selected.isActive
                      ? 'Active — click to turn off'
                      : 'Inactive — click to turn on'
                  }
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                    selected.isActive ? 'bg-[#10b981]' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      selected.isActive ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* System prompt */}
            <div className="mt-5 flex flex-1 flex-col">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                System prompt template
              </label>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[200px] flex-1 resize-y rounded-lg border border-line bg-surf2 p-3 font-mono text-[12px] leading-relaxed text-t1 outline-none transition-colors focus:border-navy"
              />
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between">
              <span className="font-mono text-[11px] text-t5">
                Used in {selected.usedIn} evaluation{selected.usedIn === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={onDiscard}
                  disabled={!dirty || pending}
                  className="rounded-lg border border-line px-4 py-2 text-[13px] font-medium text-t3 transition-colors hover:text-t1 disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  onClick={onSave}
                  disabled={!dirty || pending}
                  className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-navy/90 disabled:opacity-40"
                >
                  <Save className="h-4 w-4" />
                  {pending ? 'Saving…' : 'Save persona'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-7 text-center">
            <p className="text-[13px] text-t5">No personas yet.</p>
            <button
              onClick={onNew}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy/90 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              New persona
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
