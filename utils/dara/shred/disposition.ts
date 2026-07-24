// Deterministic guardrail for the 'administrative' disposition.
//
// The classifier (a fast model classifying ~150 candidates in one call) intermittently drops a
// substantive scope-of-work task into 'administrative' just because its verb reads as routine — e.g.
// "The contractor shall review drawings, Depot Maintenance Work Requirements (DMWRs), Technical Manuals
// (TMs), process standards, specifications, and other work documentation to evaluate parts, coatings...".
// That is a real depot-maintenance performance task, not boilerplate; the prompt says so (and even
// carries that exact sentence as a counter-example), but a cheap model over a long batch does not honor
// it reliably. This gate enforces the rule in code, independent of the model.
//
// Administrative is meant to be NARROW — only genuine boilerplate that recurs across essentially every
// federal contract: (a) proposal submission mechanics, and (b) standard flow-down mandates (clearances /
// installation access, mandatory training, background/identity checks, IT-security frameworks, and
// registrations), plus reps & certs. We keep an 'administrative' label ONLY when the text actually shows
// one of those signals. An administrative-labeled obligation with NO such signal is a mis-bucket and is
// corrected to 'compliance' so the real requirement is visible. FAR/DFARS clause boilerplate is exempt —
// it is genuinely administrative even without one of these keywords.

const ADMIN_SIGNAL = new RegExp(
  [
    // (a) proposal submission mechanics
    'page\\s+limit', 'not\\s+to\\s+exceed\\s+\\d', 'shall\\s+not\\s+exceed\\s+\\d', 'page\\s+count',
    '\\bfont\\b', '\\bmargins?\\b', 'double[-\\s]?spac', 'single[-\\s]?spac', 'volume\\s+[ivx1-9]',
    '\\btab\\s+\\d', 'cover\\s+(page|letter|sheet)', 'table\\s+of\\s+contents', 'file\\s+(format|naming|type)',
    'submitted?\\s+(via|by|no\\s+later|electronically|through|in\\s+pdf)', 'due\\s+(date|no\\s+later)',
    'format(ting)?\\s+(requirement|instruction|guidel)',
    // reps & certs / registrations
    'reps?\\s+(and|&)\\s+certs?', 'representations?\\s+and\\s+certifications?', 'sam\\.gov',
    'system\\s+for\\s+award\\s+management', '\\bORCA\\b', 'FAR\\s+52\\.204',
    // clearances / installation access
    'security\\s+clearance', '\\bSECRET\\b', 'DD\\s?[- ]?254', 'facility\\s+clearance',
    '\\bCAC\\b', 'common\\s+access\\s+card', 'installation\\s+access', '\\bbadge',
    // mandatory training
    '\\bOPSEC\\b', 'antiterrorism', 'AT\\s+Level', 'iWATCH', '\\bTARP\\b', 'DoD\\s?8570', '\\bATCTS\\b',
    'information\\s+assurance\\s+training', 'cyber[-\\s]?awareness',
    // identity / background
    '\\bPIV\\b', 'HSPD[-\\s]?12', 'background\\s+(check|investigation)', 'e[-\\s]?verify', 'fingerprint',
    // IT-security frameworks / CUI
    'NIST\\s?(SP\\s?)?800[-\\s]?171', 'DFARS\\s+252\\.204[-\\s]?7012', 'safeguard', 'controlled\\s+unclassified',
    '\\bCUI\\b'
  ].join('|'),
  'i'
);

/**
 * Correct an over-broad 'administrative' label. Returns the disposition to persist. Only ever downgrades
 * administrative → compliance (never touches scored/compliance). FAR-clause boilerplate is left as-is.
 *
 * Generic over the disposition type so it preserves the caller's Prisma enum (RequirementDisposition)
 * rather than widening to `string`; 'compliance' is a valid member, so the cast is sound.
 */
export function gateDisposition<T extends string>(text: string, disposition: T, source: string): T {
  if (disposition === 'administrative' && source !== 'far_clause' && !ADMIN_SIGNAL.test(text)) {
    return 'compliance' as T;
  }
  return disposition;
}
