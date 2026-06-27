// Canonical DARA design-system class strings, ported from the prototype and
// the redesigned dashboard / sign-in pages. Import these instead of repeating
// the literal Tailwind strings so every page shares one vocabulary.

// Surfaces
export const card = 'rounded-[10px] border border-[#1a2f4a] bg-[#0d1527]';
export const cardPad = `${card} p-5`;
export const cardDashed =
  'rounded-[10px] border border-dashed border-[#1a2f4a] bg-[#0d1527]';

// Entrance animation (defined in styles/main.css)
export const fade = 'fade';

// Typography
export const h1 = 'text-2xl font-bold tracking-tight text-[#f0f4ff]';
export const subtitle = 'text-[13px] text-[#7d97b3]';
export const eyebrow =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-[#3d5270]';
export const sectionTitle = 'text-[13px] font-bold text-[#e8eef7]';
export const monoLabel =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-[#3d5270]';

// Forms
export const fieldClasses =
  'w-full rounded-lg border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-[#e8eef7] placeholder:text-[#3d5270] transition-colors focus:border-[#3b6ef0] focus:outline-none focus:ring-1 focus:ring-[#3b6ef0]';
export const labelClasses =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-[#7d97b3]';
export const checkboxClasses =
  'h-4 w-4 rounded border-[#1a2f4a] bg-[#070c16] accent-[#3b6ef0]';
export const fileInputClasses =
  'block w-full text-sm text-[#7d97b3] file:mr-3 file:rounded-md file:border-0 file:bg-[#1a2f4a] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#22405f]';

// Buttons
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#3b6ef0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd6] disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhost =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#1a2f4a] px-4 py-2 text-sm font-medium text-[#7d97b3] transition-colors hover:border-[#3b6ef0]/50 hover:text-[#e8eef7]';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#5a1f1f] px-4 py-2 text-sm font-medium text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/30';

// Status badges (evaluation / extraction status)
export const badgeBase =
  'inline-flex items-center rounded px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide';
export const statusBadge: Record<string, string> = {
  pending: 'bg-[#1a2f4a] text-[#7d97b3]',
  processing: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  running: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  complete: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  failed: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
};

// A faint accent mono "eyebrow" used inside panels (e.g. plan label)
export const accentEyebrow =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-[#3b6ef0]';
