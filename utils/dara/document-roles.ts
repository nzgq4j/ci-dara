// Document-role classification for solicitation-package uploads. Single source of truth for the
// per-file role dropdown (labels + ordering), the extracted-vs-stored split that gates text
// extraction + Modal structural parse, and the small helpers shared by the upload UI and the
// server actions. Pure (no app/server imports) so it is safe to import from client components.
//
// The role values MUST stay in lockstep with the Prisma `DocumentRole` enum
// (prisma/schema.prisma) and migration 20260714120000_document_role.

export interface DocumentRoleDef {
  value: string;
  /** Full label shown in the per-file role dropdown. */
  label: string;
  /** Short label shown as a badge in the document list. */
  badge: string;
  /**
   * true  → the file is text-extracted, structurally parsed (Modal), and feeds the shred.
   * false → the file is stored as supporting reference only (never extracted/parsed).
   */
  extracted: boolean;
}

export const DOCUMENT_ROLES: DocumentRoleDef[] = [
  { value: 'rfp_base', label: 'Base RFP / Solicitation (Sections A–M)', badge: 'Base RFP', extracted: true },
  { value: 'pws_sow', label: 'Performance Work Statement / SOW', badge: 'PWS / SOW', extracted: true },
  { value: 'cdrl', label: 'CDRL (DD Form 1423)', badge: 'CDRL', extracted: true },
  { value: 'section_j_attachment', label: 'Section J Attachment (incorporated)', badge: 'Section J', extracted: true },
  { value: 'amendment', label: 'Amendment', badge: 'Amendment', extracted: true },
  { value: 'wage_determination', label: 'Wage Determination (stored, not extracted)', badge: 'Wage det.', extracted: false },
  { value: 'past_performance_template', label: 'Past Performance Template (not extracted)', badge: 'Past perf.', extracted: false },
  { value: 'questionnaire', label: 'Questionnaire (not extracted)', badge: 'Questionnaire', extracted: false },
  { value: 'market_research', label: 'Market Research (not extracted)', badge: 'Market rsch.', extracted: false },
  { value: 'other_supporting', label: 'Other Supporting Material (not extracted)', badge: 'Supporting', extracted: false }
];

const BY_VALUE = new Map(DOCUMENT_ROLES.map((r) => [r.value, r]));

export const DOCUMENT_ROLE_VALUES = DOCUMENT_ROLES.map((r) => r.value);

/** Narrow an arbitrary string to a known role value. */
export function isValidRole(role: string | null | undefined): boolean {
  return !!role && BY_VALUE.has(role);
}

/**
 * Whether a document with this role should be text-extracted + structurally parsed.
 * A null/absent role (pre-feature rows, or non-solicitation docs like proposals) is treated as
 * extracted — the legacy behaviour where everything was extracted.
 */
export function isExtractedRole(role: string | null | undefined): boolean {
  if (!role) return true;
  return BY_VALUE.get(role)?.extracted ?? true;
}

/** Full dropdown label for a role value (falls back to the raw value). */
export function roleLabel(role: string | null | undefined): string {
  return (role && BY_VALUE.get(role)?.label) || (role ?? '');
}

/** Short badge label for a role value (empty string when there is no role). */
export function roleBadge(role: string | null | undefined): string {
  return (role && BY_VALUE.get(role)?.badge) || '';
}
