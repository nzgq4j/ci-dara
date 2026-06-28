// Canonical DARA design-system class strings, ported from the prototype and
// the redesigned dashboard / sign-in pages. Import these instead of repeating
// the literal Tailwind strings so every page shares one vocabulary.

// Surfaces
export const card = 'rounded-[10px] border border-line bg-surf';
export const cardPad = `${card} p-5`;
export const cardDashed =
  'rounded-[10px] border border-dashed border-line bg-surf';

// Entrance animation (defined in styles/main.css)
export const fade = 'fade';

// Typography
export const h1 = 'text-2xl font-bold tracking-tight text-t1';
export const subtitle = 'text-[13px] text-t4';
export const eyebrow =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-t5';
export const sectionTitle = 'text-[13px] font-bold text-t1';
export const monoLabel =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-t5';

// Forms
export const fieldClasses =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-t1 placeholder:text-t5 transition-colors focus:border-[#3b6ef0] focus:outline-none focus:ring-1 focus:ring-[#3b6ef0]';
export const labelClasses =
  'font-mono text-[10px] uppercase tracking-[0.08em] text-t4';
export const checkboxClasses =
  'h-4 w-4 rounded border-line bg-bg accent-[#3b6ef0]';
export const fileInputClasses =
  'block w-full text-sm text-t4 file:mr-3 file:rounded-md file:border-0 file:bg-line file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#22405f]';

// Buttons
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#3b6ef0] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2f5fd6] disabled:cursor-not-allowed disabled:opacity-40';
export const btnGhost =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-t4 transition-colors hover:border-[#3b6ef0]/50 hover:text-t1';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#5a1f1f] px-4 py-2 text-sm font-medium text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/30';

// Status badges (evaluation / extraction status)
export const badgeBase =
  'inline-flex items-center rounded px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide';
export const statusBadge: Record<string, string> = {
  pending: 'bg-line text-t4',
  processing: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  running: 'bg-[#3b6ef0]/20 text-[#6f9bf5]',
  complete: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  failed: 'bg-[#5a1f1f]/30 text-[#e07d7d]'
};

// A faint accent mono "eyebrow" used inside panels (e.g. plan label)
export const accentEyebrow =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-[#3b6ef0]';
