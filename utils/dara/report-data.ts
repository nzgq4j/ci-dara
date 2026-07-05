// Shared loader for the Solicitation Analysis Report. Both the report page and the PDF
// export route build their view from this single model so they can never drift. The logic
// mirrors what the page previously computed inline (findings, scores, checklist, deadline).

import { Prisma } from '@prisma/client';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, canViewSolicitation } from '@/utils/dara/sol-access';
import { severityRank, estEffortLabel, type SeverityValue } from '@/components/dara/reportBits';
import type { ReportFinding } from '@/components/dara/ReportFindings';
import type { ChecklistItem } from '@/components/dara/ChecklistPanel';

export const PASS_META = [
  { type: 'compliance_format', label: 'Pass 1 · Compliance' },
  { type: 'technical_responsiveness', label: 'Pass 2 · Responsiveness' },
  { type: 'risk_competitive', label: 'Pass 3 · Risk' }
] as const;

const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, resolved: 2 };

export function readChecklist(json: Prisma.JsonValue | null | undefined): ChecklistItem[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((raw) => {
      const it = raw as { label?: unknown; state?: unknown; detail?: unknown };
      const label = String(it?.label ?? '').trim();
      if (!label) return null;
      const state = ['pass', 'fail', 'na'].includes(String(it?.state)) ? (it.state as ChecklistItem['state']) : 'na';
      return { label, state, detail: String(it?.detail ?? '') };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);
}

export function scoreBand(score: number | null): string {
  if (score == null) return 'Not scored';
  if (score >= 85) return 'Strong · green band';
  if (score >= 70) return 'Submittable · amber band';
  return 'At risk · red band';
}

export interface ReportPassCard {
  label: string;
  score: number | null;
  findings: number;
  running: boolean;
  progress: number;
}

export interface ReportModel {
  id: string;
  title: string;
  solNumber: string;
  metaLine: string;
  isDirect: boolean;
  generatedAt: Date | null;
  overall: number | null;
  scoreBand: string;
  passCards: ReportPassCard[];
  recommendation: string;
  recommendedSubmitAt: Date | null;
  findings: ReportFinding[];
  counts: Record<SeverityValue, number>;
  openCount: number;
  inProgressCount: number;
  resolvedCount: number;
  estRemaining: string;
  checklist: ChecklistItem[];
  dueDate: Date | null;
  daysToDeadline: number | null;
  hasReport: boolean;
}

type RawFinding = {
  id: bigint;
  severity: string;
  text: string;
  recommendedAction: string;
  requirementRef: string;
  ownerRole: string;
  ownerName: string;
  effortBand: string | null;
  effortEstimate: string;
  status: string;
  sortOrder: number;
};

/**
 * Load the full report model for a solicitation, enforcing the same view access as the page.
 * Returns null when the solicitation doesn't exist or the user can't view it (caller 404s).
 */
export async function loadReportModel(
  solId: bigint,
  daraUser: { id: string; companyId: bigint; role: string }
): Promise<ReportModel | null> {
  const data = await withTenant(daraUser.companyId, async (tx) => {
    const sol = await tx.solicitation.findFirst({
      where: { id: solId, companyId: daraUser.companyId },
      include: {
        departments: { select: { teamId: true } },
        directReviews: { include: { findings: true } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { passes: { include: { findings: true } } }
        }
      }
    });
    if (!sol) return null;
    const teamSet = new Set(await userTeamIds(tx, daraUser.id));
    if (!canViewSolicitation(daraUser.id, daraUser.role, sol.createdBy, sol.departments.map((d) => d.teamId), teamSet)) {
      return null;
    }
    return sol;
  });

  if (!data) return null;

  const isDirect = data.mode === 'direct_ai';
  const directReview = data.directReviews[0] ?? null;
  const review = data.reviews[0] ?? null;

  let rawFindings: RawFinding[] = [];
  let overall: number | null = null;
  let recommendation = '';
  let recommendedSubmitAt: Date | null = null;
  let checklist: ChecklistItem[] = [];
  let generatedAt: Date | null = null;
  let passCards: ReportPassCard[] = [];

  if (isDirect && directReview) {
    rawFindings = directReview.findings as unknown as RawFinding[];
    overall = directReview.score;
    recommendation = directReview.recommendation ?? '';
    recommendedSubmitAt = directReview.recommendedSubmitAt ?? null;
    checklist = readChecklist(directReview.checklist);
    generatedAt = directReview.runAt ?? directReview.completedAt ?? null;
  } else if (!isDirect && review) {
    rawFindings = review.passes.flatMap((p) => p.findings as unknown as RawFinding[]);
    const scored = review.passes.filter((p) => p.score != null);
    overall = scored.length ? Math.round(scored.reduce((n, p) => n + (p.score ?? 0), 0) / scored.length) : null;
    recommendation = review.recommendation ?? '';
    recommendedSubmitAt = review.recommendedSubmitAt ?? null;
    checklist = readChecklist(review.checklist);
    generatedAt = review.updatedAt;
    passCards = PASS_META.map((pm) => {
      const p = review.passes.find((x) => x.passType === pm.type);
      return {
        label: pm.label,
        score: p?.score ?? null,
        findings: p?.findingsCount ?? 0,
        running: p?.status === 'running' || p?.status === 'queued',
        progress: p?.progress ?? 0
      };
    });
  }

  const findings: ReportFinding[] = rawFindings
    .map((f) => ({
      id: f.id.toString(),
      severity: f.severity,
      text: f.text,
      recommendedAction: f.recommendedAction,
      requirementRef: f.requirementRef,
      ownerRole: f.ownerRole,
      ownerName: f.ownerName,
      effortBand: f.effortBand,
      effortEstimate: f.effortEstimate,
      status: (['open', 'in_progress', 'resolved'].includes(f.status) ? f.status : 'open') as ReportFinding['status']
    }))
    .sort(
      (a, b) =>
        severityRank(b.severity) - severityRank(a.severity) ||
        (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0)
    );

  const counts: Record<SeverityValue, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) if (f.severity in counts) counts[f.severity as SeverityValue]++;
  const openFindings = findings.filter((f) => f.status !== 'resolved');
  const openCount = openFindings.length;
  const inProgressCount = findings.filter((f) => f.status === 'in_progress').length;
  const resolvedCount = findings.filter((f) => f.status === 'resolved').length;
  const estRemaining = estEffortLabel(openFindings.map((f) => f.effortBand));

  const dueDate = data.dueDate ?? null;
  const daysToDeadline = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / 86400000) : null;
  const metaLine = [data.solNumber, data.naics && `NAICS ${data.naics}`, data.agency].filter(Boolean).join(' · ');

  return {
    id: data.id.toString(),
    title: data.title,
    solNumber: data.solNumber,
    metaLine,
    isDirect,
    generatedAt,
    overall,
    scoreBand: scoreBand(overall),
    passCards,
    recommendation,
    recommendedSubmitAt,
    findings,
    counts,
    openCount,
    inProgressCount,
    resolvedCount,
    estRemaining,
    checklist,
    dueDate,
    daysToDeadline,
    hasReport: overall != null || findings.length > 0
  };
}
