import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ChevronRight, FolderKanban, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { userTeamIds, canViewSolicitation } from '@/utils/dara/sol-access';
import { enqueueDirectReview } from '@/utils/dara/direct-review';
import { enqueueReviewRun, triggerWorker } from '@/utils/dara/passes';
import { card } from '@/components/dara/theme';
import { CountdownChip } from '@/components/dara/ReviewModeBits';
import {
  SEVERITY,
  type SeverityValue,
  severityRank,
  DistributionBar,
  ScoreCard,
  StatCard,
  estEffortLabel
} from '@/components/dara/reportBits';
import ReportFindings, { type ReportFinding } from '@/components/dara/ReportFindings';
import ChecklistPanel, { type ChecklistItem } from '@/components/dara/ChecklistPanel';
import ReportToolbar from '@/components/dara/ReportToolbar';
import { Prisma } from '@prisma/client';

type StepResult = { ok: boolean; error?: string };

const PASS_META = [
  { type: 'compliance_format', label: 'Pass 1 · Compliance' },
  { type: 'technical_responsiveness', label: 'Pass 2 · Responsiveness' },
  { type: 'risk_competitive', label: 'Pass 3 · Risk' }
] as const;
const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, resolved: 2 };

async function authedUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

function readChecklist(json: Prisma.JsonValue | null | undefined): ChecklistItem[] {
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

// ---- Server actions -------------------------------------------------------

async function updateFinding(formData: FormData): Promise<StepResult> {
  'use server';
  try {
    const daraUser = await authedUser();
    const companyId = daraUser.companyId;
    const findingId = BigInt(String(formData.get('findingId')));
    const data: Prisma.FindingUpdateManyMutationInput = {};
    const status = formData.get('status');
    if (status != null && ['open', 'in_progress', 'resolved'].includes(String(status))) {
      data.status = String(status) as Prisma.FindingUpdateManyMutationInput['status'];
    }
    const ownerName = formData.get('ownerName');
    if (ownerName != null) data.ownerName = String(ownerName).slice(0, 120);
    if (Object.keys(data).length === 0) return { ok: true };

    const updated = await withTenant(companyId, (tx) =>
      tx.finding.updateMany({ where: { id: findingId, companyId }, data })
    );
    if (updated.count === 0) return { ok: false, error: 'Finding not found.' };
    return { ok: true };
  } catch (e) {
    console.error('[report] updateFinding failed:', e);
    return { ok: false, error: 'Could not save the change.' };
  }
}

async function toggleChecklistItem(formData: FormData): Promise<StepResult> {
  'use server';
  try {
    const daraUser = await authedUser();
    const companyId = daraUser.companyId;
    const solId = BigInt(String(formData.get('solId')));
    const index = Number(formData.get('index'));
    const state = String(formData.get('state'));
    if (!['pass', 'fail', 'na'].includes(state)) return { ok: false, error: 'Invalid state.' };

    await withTenant(companyId, async (tx) => {
      const sol = await tx.solicitation.findFirst({ where: { id: solId, companyId }, select: { mode: true } });
      if (!sol) return;
      if (sol.mode === 'direct_ai') {
        const dr = await tx.directReview.findFirst({ where: { solicitationId: solId, companyId }, select: { id: true, checklist: true } });
        if (!dr) return;
        const items = readChecklist(dr.checklist);
        if (items[index]) {
          items[index].state = state as ChecklistItem['state'];
          await tx.directReview.update({ where: { id: dr.id }, data: { checklist: items as unknown as Prisma.InputJsonValue } });
        }
      } else {
        const rv = await tx.review.findFirst({ where: { solicitationId: solId, companyId }, orderBy: { createdAt: 'desc' }, select: { id: true, checklist: true } });
        if (!rv) return;
        const items = readChecklist(rv.checklist);
        if (items[index]) {
          items[index].state = state as ChecklistItem['state'];
          await tx.review.update({ where: { id: rv.id }, data: { checklist: items as unknown as Prisma.InputJsonValue } });
        }
      }
    });
    return { ok: true };
  } catch (e) {
    console.error('[report] toggleChecklistItem failed:', e);
    return { ok: false, error: 'Could not update the checklist.' };
  }
}

async function regenerateReport(formData: FormData): Promise<StepResult> {
  'use server';
  try {
    const daraUser = await authedUser();
    const companyId = daraUser.companyId;
    const solId = BigInt(String(formData.get('solId')));
    const sol = await withTenant(companyId, (tx) =>
      tx.solicitation.findFirst({ where: { id: solId, companyId }, select: { id: true, mode: true } })
    );
    if (!sol) return { ok: false, error: 'Solicitation not found.' };

    if (sol.mode === 'direct_ai') {
      await enqueueDirectReview(solId, companyId);
    } else {
      const rv = await withTenant(companyId, (tx) =>
        tx.review.findFirst({ where: { solicitationId: solId, companyId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      );
      if (!rv) return { ok: false, error: 'No color-team review to regenerate. Start one from the workspace.' };
      await enqueueReviewRun(rv.id, companyId);
    }
    triggerWorker();
    revalidatePath(`/app/solicitations/${solId}/report`);
    return { ok: true };
  } catch (e) {
    console.error('[report] regenerateReport failed:', e);
    return { ok: false, error: 'Could not start the review.' };
  }
}

// ---- Page -----------------------------------------------------------------

export default async function AnalysisReportPage({ params }: { params: { id: string } }) {
  const daraUser = await authedUser();
  if (!/^\d+$/.test(params.id)) notFound();
  const solId = BigInt(params.id);

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

  if (!data) notFound();

  const isDirect = data.mode === 'direct_ai';
  const directReview = data.directReviews[0] ?? null;
  const review = data.reviews[0] ?? null;

  // Unified finding list + holistic outputs, per paradigm.
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
  let rawFindings: RawFinding[] = [];
  let overall: number | null = null;
  let recommendation = '';
  let recommendedSubmitAt: Date | null = null;
  let checklist: ChecklistItem[] = [];
  let generatedAt: Date | null = null;
  let passCards: { label: string; score: number | null; findings: number; running: boolean; progress: number }[] = [];

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

  const now = Date.now();
  const dueDate = data.dueDate ?? null;
  const daysToDeadline = dueDate ? Math.ceil((dueDate.getTime() - now) / 86400000) : null;

  const metaLine = [data.solNumber, data.naics && `NAICS ${data.naics}`, data.agency].filter(Boolean).join(' · ');
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  const hasReport = overall != null || findings.length > 0;

  return (
    <div className="report-print mx-auto max-w-[1180px] fade">
      {/* Header */}
      <div className="mb-5">
        <nav className="mb-2 flex items-center gap-1 text-[12px] text-t5">
          <Link href={`/app/solicitations/${data.id}`} className="transition-colors hover:text-t2">
            Solicitation
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-t3">Analysis Report</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-t1">{data.title}</h1>
            {metaLine && <p className="mt-1 text-[13px] text-t4">{metaLine}</p>}
            {generatedAt && (
              <p className="mt-1 text-[12px] text-t5">Generated {fmtDate(generatedAt)}</p>
            )}
          </div>
          <ReportToolbar
            solId={data.id.toString()}
            title={data.title}
            findings={findings}
            regenerateAction={regenerateReport}
            regenerateLabel={hasReport ? 'Regenerate' : 'Run Review'}
          />
        </div>
      </div>

      {!hasReport ? (
        <div className={`${card} px-6 py-16 text-center`}>
          <AlertTriangle className="mx-auto h-9 w-9 text-t5" />
          <p className="mx-auto mt-4 max-w-md text-[13px] text-t4">
            This solicitation doesn’t have a completed review yet. Run the review to generate the analysis
            report — the executive summary, prioritized findings, and pre-submission checklist populate
            automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="space-y-5">
            {/* A · Executive summary */}
            <section className={`${card} overflow-hidden`}>
              <SectionHeader letter="A" title="Executive Summary" />
              <div className="p-4">
                <div className="flex flex-wrap gap-3">
                  <ScoreCard eyebrow="Overall Score" score={overall} sub={scoreBand(overall)} highlight />
                  {isDirect ? (
                    <>
                      <StatCard eyebrow="Open" value={openCount} sub="findings to address" />
                      <StatCard eyebrow="In Progress" value={inProgressCount} sub="being worked" />
                      <StatCard eyebrow="Resolved" value={resolvedCount} sub="closed out" />
                    </>
                  ) : (
                    passCards.map((pc) => (
                      <ScoreCard
                        key={pc.label}
                        eyebrow={pc.label}
                        score={pc.score}
                        sub={`${pc.findings} finding${pc.findings === 1 ? '' : 's'}`}
                        running={pc.running}
                        progress={pc.progress}
                      />
                    ))
                  )}
                </div>
                {recommendation && (
                  <p className="mt-4 border-l-2 border-navy/30 pl-4 text-[13px] leading-relaxed text-t3">
                    {recommendation}
                  </p>
                )}
              </div>
            </section>

            {/* B · Prioritized findings & action plan */}
            <section className={`${card} overflow-hidden`}>
              <SectionHeader
                letter="B"
                title="Prioritized Findings &amp; Action Plan"
                right={`${findings.length} finding${findings.length === 1 ? '' : 's'} · ordered by severity`}
              />
              <ReportFindings findings={findings} updateAction={updateFinding} />
            </section>
          </div>

          {/* Right rail */}
          <div className="space-y-4">
            {/* Deadline */}
            <div className="rounded-[10px] border border-navy/30 bg-navy/[0.04] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.07em] text-t5">Submission Deadline</div>
              {daysToDeadline != null ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-[30px] font-bold leading-none text-t1">{Math.max(0, daysToDeadline)}</span>
                    <span className="text-[13px] text-t4">days</span>
                    <span className="ml-auto">
                      <CountdownChip days={daysToDeadline} />
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-t4">{fmtDate(dueDate)}</div>
                </>
              ) : (
                <div className="mt-1 text-[13px] text-t4">No due date set</div>
              )}
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[12px]">
                <Row label="Open findings" value={String(openCount)} strong={openCount > 0} />
                <Row label="Resolved findings" value={String(resolvedCount)} />
                <Row label="Est. effort remaining" value={estRemaining} />
              </dl>
            </div>

            {/* Finding distribution */}
            <div className={`${card} p-4`}>
              <div className="mb-3 text-[13px] font-bold text-t1">Finding Distribution</div>
              <DistributionBar counts={counts} />
            </div>

            {/* DARA recommendation */}
            {(recommendation || recommendedSubmitAt) && (
              <div className="rounded-[10px] border border-gold/40 bg-gold/[0.06] p-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-t1">
                  <AlertTriangle className="h-3.5 w-3.5 text-gold" /> DARA Recommendation
                </div>
                {recommendation && <p className="text-[12px] leading-relaxed text-t3">{recommendation}</p>}
                {recommendedSubmitAt && (
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-t2">
                    <Clock className="h-3.5 w-3.5 text-gold" />
                    Recommended submission: {fmtDate(recommendedSubmitAt)}
                  </p>
                )}
              </div>
            )}

            {/* Quick actions */}
            <div className={`${card} p-4`}>
              <div className="mb-2.5 text-[13px] font-bold text-t1">Quick Actions</div>
              <div className="space-y-2">
                <QuickLink href={`/app/solicitations/${data.id}`} label="Open Compliance Matrix" primary />
                <QuickLink href={`/app/solicitations/${data.id}`} label="Open Workspace" />
              </div>
            </div>

            {/* Pre-submission checklist */}
            <div className={`${card} p-4`}>
              <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-t1">
                <FolderKanban className="h-3.5 w-3.5 text-t4" /> Pre-Submission Checklist
              </div>
              <ChecklistPanel items={checklist} toggleAction={toggleChecklistItem} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ letter, title, right }: { letter: string; title: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-navy px-4 py-2.5">
      <div className="flex items-center gap-2 text-white">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-white/15 font-mono text-[11px] font-bold">
          {letter}
        </span>
        <h2 className="text-[13px] font-bold uppercase tracking-wide" dangerouslySetInnerHTML={{ __html: title }} />
      </div>
      {right && <span className="text-[11px] text-white/60">{right}</span>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-t4">{label}</dt>
      <dd className={strong ? 'font-semibold text-[#991B1B]' : 'font-semibold text-t2'}>{value}</dd>
    </div>
  );
}

function QuickLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-medium transition-colors ${
        primary ? 'bg-navy text-white hover:bg-navy/90' : 'border border-line text-t3 hover:border-navy/30 hover:text-t1'
      }`}
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
    </Link>
  );
}

function scoreBand(score: number | null): string {
  if (score == null) return 'Not scored';
  if (score >= 85) return 'Strong · green band';
  if (score >= 70) return 'Submittable · amber band';
  return 'At risk · red band';
}
