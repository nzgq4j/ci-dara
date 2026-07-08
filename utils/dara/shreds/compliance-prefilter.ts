// utils/dara/shreds/compliance-prefilter.ts
//
// Deterministic pre-classification for compliance requirements.
// Runs BEFORE the LLM batch sweep in sweepRequirements / runComplianceCheck.
// Requirements it resolves are written directly to the DB — no LLM call needed.
// Requirements it cannot resolve are returned for normal LLM processing.
//
// Phase 1 of the DARA GenAI optimization — additive only,
// no schema changes required.

import { withTenant } from '@/utils/prisma';

export interface MinReq {
  id: bigint;
  name: string;
  description: string | null;
  farReference: string;
}

export interface PrefilterResult {
  // Requirements that could not be resolved deterministically.
  // Pass these to sweepRequirements unchanged.
  needsLLM: MinReq[];
  // How many requirements were resolved without an LLM call.
  determinedCount: number;
}

// ---------------------------------------------------------------------------
// Pattern sets
// ---------------------------------------------------------------------------

// Patterns that reliably identify ADMINISTRATIVE requirements:
// compliance facts that exist outside the proposal narrative and therefore
// cannot be verified from extracted proposal text. Classify as not_applicable
// rather than sending to the LLM which cannot grade them either.
//
// Rule for adding a pattern: it must match text whose compliance status is
// a registration, certification, or logistical fact — NOT something a reviewer
// would look for in the proposal body.
const ADMINISTRATIVE_PATTERNS: RegExp[] = [
  // Registration / identity
  /\bsam\.gov\b|\bsam registration\b|\bactive (in )?sam\b/i,
  /\bcage code\b|\buei (number|code)\b|\bduns (number|code)\b/i,
  /\bregistrations? (must be|shall be|is required to be) (active|current|valid)\b/i,

  // Reps and certs / small business status
  /\brepresentations? and certifications?\b|\breps?\s*(&|and)\s*certs?\b/i,
  /\bsize status\b|\bsmall business (concern|representation)\b/i,
  /\b(hubzone|sdvosb|wosb|8\(a\)|vosb) (certified|certification|status)\b/i,

  // Submission logistics — due dates, copies, delivery address, portal
  /\bproposal (due|must be (received|submitted)) (by|no later than)\b/i,
  /\bsubmission (due date|deadline|cut-?off)\b/i,
  /\b(electronic|paper|hard) cop(y|ies)\b.*\bsubmit\b/i,
  /\bnumber of copies\b|\bcopy count\b/i,
  /\bdelivery address\b|\bsubmit (via|through|to) (portal|email|hard copy)\b/i,
  /\bsolicit(ation)? (number|no\.?) (must appear|shall appear|on (the )?(cover|label))\b/i,

  // File format / naming — administrative logistics, not proposal content
  /\b(pdf|docx?|xlsx?|file) (format|only|required)\b.*\bsubmit\b/i,
  /\bfile naming (convention|requirement)\b/i,

  // FAR/DFARS clauses incorporated by reference
  /\bincorporated by reference\b/i,
  /\bfar\s+\d{1,2}\.\d{3,}-?\d*\b.*\bincorporated\b/i,
  /\bdfars\s+\d{3,}\.\d{3,}-?\d*\b.*\bincorporated\b/i,
];

// Patterns that OVERRIDE administrative classification —
// if any of these match, the requirement must go to the LLM regardless
// of whether an administrative pattern also matches.
// These indicate something a reviewer can actually grade in the proposal body.
const MUST_LLM_PATTERNS: RegExp[] = [
  // Explicit offeror obligations to write or describe something
  /\b(the )?offeror (shall|must|will) (provide|submit|describe|demonstrate|address|include|identify|discuss|explain|present)\b/i,
  /\bshall (provide|submit|describe|demonstrate|address|include|identify|discuss|explain|present)\b/i,

  // Page and volume limits — graded against extracted text
  /\bpage (limit|count|maximum|not to exceed)\b/i,
  /\bnot to exceed\s+\d+\s+pages?\b/i,
  /\bvolume\s+[ivxIVX\d]+\b/i,

  // Technical approach, management, staffing — always in proposal body
  /\btechnical approach\b|\bmanagement approach\b|\bstaffing plan\b/i,
  /\bpast performance\b|\brelevant experience\b/i,
  /\bkey personnel\b|\bprincipal investigator\b|\bproject manager\b/i,

  // Section L / M references that require proposal content
  /\bsection [lm]\b.*\brequi(re|red)\b/i,
];

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

function classifyRequirement(
  req: MinReq,
): 'not_applicable' | 'llm_needed' {
  const text = [req.name, req.description ?? '', req.farReference]
    .join(' ')
    .trim();

  // Must-LLM check runs first — it overrides administrative patterns.
  if (MUST_LLM_PATTERNS.some((p) => p.test(text))) return 'llm_needed';

  if (ADMINISTRATIVE_PATTERNS.some((p) => p.test(text))) {
    return 'not_applicable';
  }

  return 'llm_needed';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pre-classify compliance requirements deterministically before sending them
 * to the LLM batch sweep.
 *
 * Requirements classified as not_applicable are written directly to the DB
 * in a single batch transaction — they consume no LLM tokens.
 *
 * Returns the subset that still needs LLM processing, plus a count of how
 * many were resolved here so the caller can include them in its progress total.
 */
export async function prefilterCompliance(
  companyId: bigint,
  requirements: MinReq[],
): Promise<PrefilterResult> {
  const needsLLM: MinReq[] = [];
  const notApplicable: bigint[] = [];

  for (const req of requirements) {
    const verdict = classifyRequirement(req);
    if (verdict === 'not_applicable') {
      notApplicable.push(req.id);
    } else {
      needsLLM.push(req);
    }
  }

  if (notApplicable.length > 0) {
    await withTenant(companyId, async (tx) => {
      // Use updateMany with id IN list — one round-trip regardless of count.
      await tx.requirement.updateMany({
        where: { id: { in: notApplicable } },
        data: { complianceStatus: 'not_applicable' },
      });
    });

    console.log(
      `[prefilter] ${notApplicable.length} requirements classified as not_applicable ` +
        `without LLM; ${needsLLM.length} sent to sweep.`,
    );
  }

  return { needsLLM, determinedCount: notApplicable.length };
}
