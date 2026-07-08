// utils/dara/shreds/validate-output.ts
//
// Inline quality checks on parsed LLM outputs.
// These run AFTER parsing and BEFORE any DB write.
// Phase 1 of the DARA GenAI optimization — additive only,
// no schema changes required.

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  // true = do not write this output to the DB
  blocked: boolean;
}

// ---------------------------------------------------------------------------
// Compliance determination validator
// Called per batch item inside sweepRequirements after parseBatchResults.
// ---------------------------------------------------------------------------

const VALID_DETERMINATIONS = new Set([
  'compliant',
  'non_compliant',
  'unable_to_determine',
]);

/**
 * Validate one compliance determination before it is written to the DB.
 * Does not block on unknown determinations — mapDetermination in evaluator.ts
 * already normalises those to 'partial'. Blocks only on a fully absent
 * determination, which indicates the model produced no usable output.
 */
export function validateComplianceDetermination(
  requirementId: string,
  determination: string | null,
  rationale: string,
): ValidationResult {
  const warnings: string[] = [];

  const norm = (determination ?? '').trim().toLowerCase().replace(/-/g, '_');

  if (!VALID_DETERMINATIONS.has(norm)) {
    warnings.push(
      `[quality] Unknown determination "${determination}" for requirement ` +
        `${requirementId} — mapDetermination will normalise to partial.`,
    );
  }

  // A rationale shorter than 20 characters is effectively empty.
  // The determination is not blocked — partial is an acceptable fallback —
  // but the warning surfaces in logs for quality monitoring.
  if (!rationale || rationale.trim().length < 20) {
    warnings.push(
      `[quality] Rationale too short for requirement ${requirementId} ` +
        `(${rationale?.trim().length ?? 0} chars) — determination may be unreliable.`,
    );
  }

  // Block only when the determination is entirely absent.
  const blocked = determination == null || determination.trim() === '';
  if (blocked) {
    warnings.push(
      `[quality] Blocked: no determination returned for requirement ${requirementId}.`,
    );
  }

  return { valid: warnings.length === 0, warnings, blocked };
}

// ---------------------------------------------------------------------------
// Shredded requirement validator
// Called per item inside shredRequirements after parseShred.
// ---------------------------------------------------------------------------

const VALID_SOURCES = new Set([
  'instruction',
  'evaluation_factor',
  'sow_pws',
  'far_clause',
  'other',
]);

const VALID_DISPOSITIONS = new Set(['scored', 'compliance', 'administrative']);

/**
 * Validate one shredded requirement before it is written to the DB.
 * Blocks requirements with no name, no description, or a description
 * so short it is likely a hallucination or a truncated parse.
 */
export function validateShreddedRequirement(req: {
  name: string;
  description: string;
  source: string;
  disposition: string;
  citation: string;
}): ValidationResult {
  const warnings: string[] = [];

  if (!req.name || req.name.trim().length < 3) {
    warnings.push('[quality] Blocked: requirement name too short or missing.');
    return { valid: false, warnings, blocked: true };
  }

  if (!req.description || req.description.trim().length < 10) {
    warnings.push(
      `[quality] Blocked: requirement "${req.name}" has no description ` +
        `— likely a hallucination or truncated parse.`,
    );
    return { valid: false, warnings, blocked: true };
  }

  if (!VALID_SOURCES.has(req.source)) {
    warnings.push(
      `[quality] Unknown source "${req.source}" for "${req.name}" ` +
        `— mapShredItem will default to other.`,
    );
    // Not blocked — mapShredItem in prompt.ts already handles this.
  }

  if (!VALID_DISPOSITIONS.has(req.disposition)) {
    warnings.push(
      `[quality] Unknown disposition "${req.disposition}" for "${req.name}".`,
    );
  }

  return { valid: warnings.length === 0, warnings, blocked: false };
}
