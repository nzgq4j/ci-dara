// Deterministic review-pass score derived from the pass's own findings.
//
// Why not use the model's self-reported score: asked for a 0-100 quality number with no rubric,
// the model anchors to a near-constant middling value (observed: every pass, every lens, scored 62)
// regardless of the findings it actually produced. That number is meaningless. Instead we compute
// the score from the severity of the OPEN findings the pass generated — so it differentiates passes,
// reflects real issues, and climbs as findings are auto-verified or acknowledged.
//
// 100 = no open findings. Each open finding subtracts a severity-weighted penalty; the result is
// floored at 0. Weights are a heuristic (tunable): a single critical is a big hit, a low is a nudge.

export const SEVERITY_PENALTY: Record<string, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 0.5
};

export function scoreFromFindings(findings: { severity: string; status?: string }[]): number {
  let penalty = 0;
  for (const f of findings) {
    if (f.status === 'resolved') continue; // resolved / auto-verified findings don't count against the score
    penalty += SEVERITY_PENALTY[f.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}
