import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ChevronRight, FolderKanban, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { enqueueDirectReview } from '@/utils/dara/direct-review';
import { enqueueReviewRun, triggerWorker } from '@/utils/dara/passes';
import { card } from '@/components/dara/theme';
import { CountdownChip } from '@/components/dara/ReviewModeBits';
import { DistributionBar, ScoreCard, StatCard } from '@/components/dara/reportBits';
import ReportFindings from '@/components/dara/ReportFindings';
import ChecklistPanel, { type ChecklistItem } from '@/components/dara/ChecklistPanel';
import ReportToolbar from '@/components/dara/ReportToolbar';
import { loadReportModel, readChecklist } from '@/utils/dara/report-data';
import { Prisma } from '@prisma/client';

type StepResult = { ok: boolean; error?: string };

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

  const model = await loadReportModel(solId, daraUser);
  if (!model) notFound();

  const {
    id: solIdStr,
    title,
    metaLine,
    isDirect,
    generatedAt,
    overall,
    scoreBand: band,
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
    hasReport
  } = model;

  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;

  return (
    <div className="report-print mx-auto max-w-[1180px] fade">
      {/* Header */}
      <div className="mb-5">
        <nav className="mb-2 flex items-center gap-1 text-[12px] text-t5">
          <Link href={`/app/solicitations/${solIdStr}`} className="transition-colors hover:text-t2">
            Solicitation
          </Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-t3">Analysis Report</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-t1">{title}</h1>
            {metaLine && <p className="mt-1 text-[13px] text-t4">{metaLine}</p>}
            {generatedAt && (
              <p className="mt-1 text-[12px] text-t5">Generated {fmtDate(generatedAt)}</p>
            )}
          </div>
          <ReportToolbar
            solId={solIdStr}
            title={title}
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
                  <ScoreCard eyebrow="Overall Score" score={overall} sub={band} highlight />
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
                <QuickLink href={`/app/solicitations/${solIdStr}`} label="Open Compliance Matrix" primary />
                <QuickLink href={`/app/solicitations/${solIdStr}`} label="Open Workspace" />
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

