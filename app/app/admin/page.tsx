import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { Save, Building2, Users, ShieldCheck, Ban, Trash2, Plus, SlidersHorizontal, Zap, BarChart2, Cpu } from 'lucide-react';
import { prismaAdmin } from '@/utils/prisma';
import {
  requirePlatformAdmin,
  listPlatformAdmins,
  isEnvPlatformAdmin,
  addPlatformAdmin,
  setPlatformAdminActive,
  removePlatformAdmin,
  banUser,
  deleteUser
} from '@/utils/dara/platform';
import { getPlatformAIView, AI_PROVIDERS } from '@/utils/dara/platform-ai';
import {
  getCapabilityOverrides,
  AI_CAPABILITIES,
  CAPABILITY_LABELS
} from '@/utils/dara/capability-model';
import { getPricingMap, costOf } from '@/utils/dara/pricing';
import { recordAudit } from '@/utils/dara/audit';
import { secretHint } from '@/utils/dara/crypto';
import {
  TRIAL_RESOURCES,
  FEATURE_FLAGS,
  FEATURE_LABELS,
  DEFAULT_TRIAL_LIMITS,
  resolveEntitlements,
  buildEntitlements,
  getPlatformDefaultEntitlements,
  setPlatformDefaultEntitlements,
  type TrialResource,
  type FeatureFlag,
  type Entitlements
} from '@/utils/dara/trial';
import ConfirmButton from '@/components/dara/ConfirmButton';
import {
  card,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnGhost,
  btnPrimary,
  btnDanger,
  sectionTitle
} from '@/components/dara/theme';

const PLANS = ['trial', 'starter', 'pro', 'enterprise'];
const PLAN_STATUSES = ['active', 'past_due', 'canceled', 'trialing'];
const PROVIDERS = ['anthropic', 'openai', 'google'];
const KEY_MODES = ['platform', 'byok'];
const ROLES = ['company_admin', 'dept_admin', 'manager', 'reviewer'];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfYesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pick(list: string[], val: string, fallback: string) {
  return list.includes(val) ? val : fallback;
}

// Kill switch: delete one active background job. Mirrors jobs/page.tsx killJob but revalidates
// the dashboard route. The worker drops the vanished row and does not requeue it.
async function killJob(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('jobId')));
  const job = await prismaAdmin.jobQueue.findUnique({ where: { id } });
  if (!job) {
    revalidatePath('/app/admin');
    return;
  }
  await prismaAdmin.jobQueue.delete({ where: { id } });
  await recordAudit({
    action: 'admin.job.kill',
    companyId: job.companyId,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'job_queue',
    entityId: id,
    metadata: {
      jobType: job.jobType,
      kind: (job.payload as { kind?: string } | null)?.kind ?? null,
      status: job.status,
      attempts: job.attempts
    }
  });
  revalidatePath('/app/admin');
}

async function updateCompany(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('companyId')));
  const trialRaw = String(formData.get('trialEndsAt') ?? '').trim();
  await prismaAdmin.company.update({
    where: { id },
    data: {
      plan: pick(PLANS, String(formData.get('plan') ?? ''), 'trial') as any,
      planStatus: pick(PLAN_STATUSES, String(formData.get('planStatus') ?? ''), 'trialing') as any,
      trialEndsAt: trialRaw ? new Date(trialRaw) : null,
      aiKeyMode: pick(KEY_MODES, String(formData.get('aiKeyMode') ?? ''), 'platform') as any,
      activeProvider: pick(PROVIDERS, String(formData.get('activeProvider') ?? ''), 'anthropic') as any,
      activeModel: String(formData.get('activeModel') ?? '').trim() || 'claude-sonnet-4-6'
    }
  });
  await recordAudit({
    action: 'admin.company.update',
    companyId: id,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'company',
    entityId: id,
    metadata: { plan: formData.get('plan'), planStatus: formData.get('planStatus') }
  });
  revalidatePath('/app/admin');
}

// Read limit + feature form fields into an entitlements pair (shared by the platform-default
// and per-company entitlement forms).
function readEntitlementsForm(formData: FormData) {
  const limits = {} as Record<TrialResource, number>;
  for (const r of TRIAL_RESOURCES) {
    const v = Number(formData.get(`limit_${r}`));
    limits[r] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : DEFAULT_TRIAL_LIMITS[r];
  }
  const features = {} as Record<FeatureFlag, boolean>;
  for (const f of FEATURE_FLAGS) features[f] = formData.get(`feature_${f}`) != null;
  return { limits, features };
}

// Platform-wide default gating — inherited by every company without an override.
async function saveDefaultGating(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const { limits, features } = readEntitlementsForm(formData);
  await setPlatformDefaultEntitlements(limits, features);
  await recordAudit({
    action: 'admin.default_gating.update',
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'platform',
    metadata: { limits, features }
  });
  revalidatePath('/app/admin');
}

// Per-company entitlement override (opt-in; only written here, never on a plain account save).
async function updateCompanyEntitlements(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('companyId')));
  const { limits, features } = readEntitlementsForm(formData);
  await prismaAdmin.company.update({ where: { id }, data: { entitlements: buildEntitlements(limits, features) as object } });
  await recordAudit({
    action: 'admin.company.entitlements.set',
    companyId: id,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'company',
    entityId: id,
    metadata: { limits, features }
  });
  revalidatePath('/app/admin');
}

// Clear a company's override so it follows the platform default again.
async function clearCompanyEntitlements(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('companyId')));
  await prismaAdmin.company.update({ where: { id }, data: { entitlements: Prisma.DbNull } });
  await recordAudit({
    action: 'admin.company.entitlements.clear',
    companyId: id,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'company',
    entityId: id
  });
  revalidatePath('/app/admin');
}

async function updateAnyUser(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  const target = await prismaAdmin.daraUser.findUnique({ where: { id: userId } });
  if (!target) return;
  const newRole = pick(ROLES, String(formData.get('role') ?? ''), target.role);
  await prismaAdmin.daraUser.update({
    where: { id: userId },
    data: { role: newRole as any }
  });
  await recordAudit({
    action: 'admin.member.update',
    companyId: target.companyId,
    actorId: admin.userId,
    actorEmail: admin.email,
    entityType: 'user',
    entityId: userId,
    metadata: { role: newRole, fromRole: target.role }
  });
  revalidatePath('/app/admin');
}

async function toggleBan(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  const banned = String(formData.get('banned') ?? '') === '1';
  await banUser(userId, banned, admin);
  revalidatePath('/app/admin');
}

async function removeUser(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  await deleteUser(userId, admin);
  revalidatePath('/app/admin');
}

async function addAdmin(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  await addPlatformAdmin(String(formData.get('email') ?? ''), admin);
  revalidatePath('/app/admin');
}

async function toggleAdmin(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('adminId')));
  const active = String(formData.get('active') ?? '') === '1';
  await setPlatformAdminActive(id, active, admin);
  revalidatePath('/app/admin');
}

async function removeAdmin(formData: FormData) {
  'use server';
  const admin = await requirePlatformAdmin();
  const id = BigInt(String(formData.get('adminId')));
  await removePlatformAdmin(id, admin);
  revalidatePath('/app/admin');
}

// Shared limit + feature inputs (names limit_<resource> / feature_<flag>), pre-filled from
// `ent`. Used by both the platform-default form and each per-company override form.
function EntitlementFields({ ent }: { ent: Entitlements }) {
  return (
    <>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        Trial limits <span className="normal-case text-t4">· apply on the trial plan</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {TRIAL_RESOURCES.map((r) => (
          <div key={r} className="space-y-1.5">
            <label className={`${labelClasses} normal-case`}>{r.replace('_', ' ')}s</label>
            <input name={`limit_${r}`} type="number" min={0} defaultValue={ent.limits[r]} className={fieldClasses} />
          </div>
        ))}
      </div>
      <div className="mb-2 mt-3 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
        Features <span className="normal-case text-t4">· uncheck to fence off</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {FEATURE_FLAGS.map((f) => (
          <label key={f} className="flex items-center gap-2 text-[13px] text-t3">
            <input type="checkbox" name={`feature_${f}`} defaultChecked={ent.features[f]} className={checkboxClasses} />
            {FEATURE_LABELS[f]}
          </label>
        ))}
      </div>
    </>
  );
}

export default async function AdminPage() {
  const me = await requirePlatformAdmin();

  const [
    companies,
    users,
    admins,
    platformDefaults,
    activeJobs,
    todayUsage,
    yesterdayAgg,
    ai,
    overrideMap,
    pricingMap
  ] = await Promise.all([
    prismaAdmin.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, solicitations: true, evaluations: true } }
      }
    }),
    prismaAdmin.daraUser.findMany({
      orderBy: { createdAt: 'asc' },
      include: { company: { select: { name: true } } }
    }),
    listPlatformAdmins(),
    getPlatformDefaultEntitlements(),
    // Active jobs for the dashboard panel
    prismaAdmin.jobQueue.findMany({
      where: { status: { in: ['pending', 'running'] } },
      orderBy: [{ status: 'asc' }, { availableAt: 'asc' }],
      include: { company: { select: { name: true } } }
    }),
    // Today's usage — grouped by company + provider + model
    prismaAdmin.aiUsageLog.groupBy({
      by: ['companyId', 'provider', 'model'],
      where: { createdAt: { gte: startOfToday() } },
      _sum: { tokenIn: true, tokenOut: true },
      orderBy: { _sum: { tokenIn: 'desc' } },
      take: 10
    }),
    // Yesterday's totals for the percentage comparison
    prismaAdmin.aiUsageLog.aggregate({
      where: { createdAt: { gte: startOfYesterday(), lt: startOfToday() } },
      _sum: { tokenIn: true, tokenOut: true }
    }),
    // Platform AI config for the stat card sub-line and keys panel
    getPlatformAIView(),
    // Capability overrides for the read-only capability table
    getCapabilityOverrides(),
    // Per-model pricing to estimate today's cost (cost is not stored on the ledger)
    getPricingMap()
  ]);

  const runningCount = activeJobs.filter((j) => j.status === 'running').length;
  const pendingCount = activeJobs.filter((j) => j.status === 'pending').length;

  // Aggregate today's usage by company (sum across provider/model rows), pricing each row.
  const byCompany = new Map<string, {
    tokenIn: number; tokenOut: number; cost: number; model: string
  }>();
  for (const r of todayUsage) {
    const key = r.companyId?.toString() ?? 'platform';
    const existing = byCompany.get(key) ?? { tokenIn: 0, tokenOut: 0, cost: 0, model: '' };
    const tin = r._sum.tokenIn ?? 0;
    const tout = r._sum.tokenOut ?? 0;
    // Track the model with the most tokens for this company
    if (tin + tout > existing.tokenIn + existing.tokenOut) {
      existing.model = r.model;
    }
    existing.tokenIn += tin;
    existing.tokenOut += tout;
    existing.cost += costOf(pricingMap, r.provider, r.model, tin, tout) ?? 0;
    byCompany.set(key, existing);
  }

  // Fetch company names for the usage table
  const usageCompanyIds = Array.from(byCompany.keys())
    .filter((k) => k !== 'platform')
    .map((k) => BigInt(k));
  const usageCompanies = usageCompanyIds.length > 0
    ? await prismaAdmin.company.findMany({
        where: { id: { in: usageCompanyIds } },
        select: { id: true, name: true }
      })
    : [];
  const companyNameById = new Map(
    usageCompanies.map((c) => [c.id.toString(), c.name])
  );

  const totalTokensToday = Array.from(byCompany.values())
    .reduce((s, r) => s + r.tokenIn + r.tokenOut, 0);
  const totalCostToday = Array.from(byCompany.values())
    .reduce((s, r) => s + r.cost, 0);

  const yesterdayTokens =
    (yesterdayAgg._sum.tokenIn ?? 0) + (yesterdayAgg._sum.tokenOut ?? 0);
  const tokenPct = yesterdayTokens > 0
    ? Math.round(((totalTokensToday - yesterdayTokens) / yesterdayTokens) * 100)
    : null;

  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return n.toString();
  }

  const trialCount = companies.filter((c) => c.plan === 'trial').length;
  const activeCount = companies.filter(
    (c) => c.planStatus === 'active' || c.planStatus === 'trialing'
  ).length;

  // Capability override map for read-only display (string-indexable view).
  const overrides = overrideMap as Record<string, { provider: string; model: string } | undefined>;

  return (
    <div>
      {/* ── Dashboard header ── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-t1">Dashboard</h1>
        <div className="flex items-center gap-1.5 text-[12px] text-t4">
          <span>{companies.length} companies</span>
          <span className="text-t5">·</span>
          <span>{users.length} users</span>
          <span className="text-t5">·</span>
          <span>{activeJobs.length} active jobs</span>
          <span className="ml-2 text-t5">···</span>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Active jobs */}
        <div className={`${card} p-4`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Active jobs
          </div>
          <div className={`mt-1 text-3xl font-bold tabular-nums ${
            activeJobs.length > 0 ? 'text-[#DC2626]' : 'text-[#16A34A]'
          }`}>
            {activeJobs.length}
          </div>
          <div className="mt-1 text-[11px] text-t4">
            {runningCount} running · {pendingCount} pending
          </div>
        </div>

        {/* Tokens today */}
        <div className={`${card} p-4`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Tokens today
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-t1">
            {fmtTokens(totalTokensToday)}
          </div>
          <div className="mt-1 text-[11px] text-t4">
            {tokenPct !== null
              ? `${tokenPct >= 0 ? '↑' : '↓'} ${Math.abs(tokenPct)}% vs yesterday`
              : 'input + output'}
          </div>
        </div>

        {/* Est. cost today */}
        <div className={`${card} p-4`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Est. cost today
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-t1">
            ${totalCostToday.toFixed(2)}
          </div>
          <div className="mt-1 text-[11px] text-t4">
            {ai.activeProvider} · {ai.activeModel}
          </div>
        </div>

        {/* Companies */}
        <div className={`${card} p-4`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Companies
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-[#16A34A]">
            {companies.length}
          </div>
          <div className="mt-1 text-[11px] text-t4">
            {activeCount} active · {trialCount} trial
          </div>
        </div>
      </div>

      {/* ── Two-column panels ── */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Live jobs panel */}
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-t1">
              <Zap className="h-4 w-4 text-t5" />Live jobs
            </span>
            <Link
              href="/app/admin/jobs"
              className="flex items-center gap-1.5 text-[12px] text-t4 transition-colors hover:text-t1"
            >
              <Ban className="h-3.5 w-3.5" />Kill all →
            </Link>
          </div>
          {activeJobs.length === 0 ? (
            <div className="p-4 text-[12px] text-t4">No active background jobs.</div>
          ) : (
            <div className="divide-y divide-line">
              {activeJobs.map((j) => {
                const p = (j.payload ?? {}) as {
                  kind?: string;
                  solicitationId?: string;
                  reviewId?: string;
                  passId?: string;
                  amendmentId?: string;
                  directReviewId?: string;
                };
                const ageMin = Math.max(
                  0,
                  Math.round(
                    (Date.now() - new Date(j.startedAt ?? j.availableAt).getTime()) / 60000
                  )
                );
                return (
                  <div key={j.id.toString()} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-t1">
                          {p.kind ?? j.jobType}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                          j.status === 'running'
                            ? 'bg-[#DBEAFE] text-[#1E40AF]'
                            : 'bg-line text-t4'
                        }`}>
                          {j.status}
                        </span>
                        {j.attempts > 3 && (
                          <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#92400E]">
                            {j.attempts} attempts
                          </span>
                        )}
                      </div>
                      {j.progressLabel && (
                        <div className="mt-0.5 truncate text-[11px] italic text-t4">
                          {j.progressLabel}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-t5">
                        {j.company.name} · started {ageMin}m ago
                      </div>
                    </div>
                    <form action={killJob} className="shrink-0">
                      <input type="hidden" name="jobId" value={j.id.toString()} />
                      <ConfirmButton
                        message={`Kill this ${p.kind ?? j.jobType} job for ${j.company.name}?`}
                        className="flex items-center gap-1.5 rounded-lg border border-[#991B1B]/40 px-3 py-1.5 text-[12px] font-medium text-[#991B1B] transition-colors hover:bg-[#FEE2E2]"
                      >
                        × Kill
                      </ConfirmButton>
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI usage today panel */}
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-t1">
              <BarChart2 className="h-4 w-4 text-t5" />AI usage — today
            </span>
            <Link
              href="/app/admin/usage"
              className="text-[12px] text-t4 transition-colors hover:text-t1"
            >
              All time →
            </Link>
          </div>
          {byCompany.size === 0 ? (
            <div className="p-4 text-[12px] text-t4">No AI calls recorded today.</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                <span>Company</span>
                <span>Model</span>
                <span className="text-right">Tokens</span>
                <span className="text-right">Cost</span>
              </div>
              <div className="divide-y divide-line">
                {Array.from(byCompany.entries()).map(([key, r]) => (
                  <div key={key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 px-4 py-2.5 text-[12px]">
                    <span className="truncate text-t1">
                      {companyNameById.get(key) ?? 'Platform'}
                    </span>
                    <span className="font-mono text-[11px] text-t4">
                      {r.model.replace('claude-', '').replace('gpt-', '')}
                    </span>
                    <span className="text-right tabular-nums text-t2">
                      {fmtTokens(r.tokenIn + r.tokenOut)}
                    </span>
                    <span className="text-right tabular-nums text-[#16A34A]">
                      ${r.cost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-t border-line px-4 py-2.5 text-[12px] font-semibold">
                <span className="text-t1">Total</span>
                <span />
                <span className="text-right tabular-nums text-t1">
                  {fmtTokens(totalTokensToday)}
                </span>
                <span className="text-right tabular-nums text-[#16A34A]">
                  ${totalCostToday.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── AI keys & models panel ── */}
      <div className={`${card} mb-8 overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-t1">
            <Cpu className="h-4 w-4 text-t5" />AI keys &amp; models — per capability
          </span>
          <Link
            href="/app/admin/ai"
            className="text-[12px] text-t4 transition-colors hover:text-t1"
          >
            Edit keys →
          </Link>
        </div>

        {/* Provider strip */}
        <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
          {AI_PROVIDERS.map((p) => (
            <div key={p} className="px-4 py-3">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                {p}
                {ai.hints[p] ? (
                  <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 text-[9px] font-bold text-[#166534]">
                    {ai.hints[p]}
                  </span>
                ) : (
                  <span className="rounded bg-line px-1.5 py-0.5 text-[9px] font-bold text-t4">
                    not set
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] font-medium text-t1">
                {ai.activeProvider === p ? ai.activeModel : '—'}
              </div>
              <div className="text-[11px] text-t4">
                {ai.activeProvider === p ? 'Platform default' : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Capability table — read-only */}
        <div className="divide-y divide-line">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-x-4 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            <span>Capability</span>
            <span>Model</span>
            <span>Override</span>
          </div>
          {(AI_CAPABILITIES as unknown as string[]).map((cap) => {
            const ov = overrides[cap];
            return (
              <div key={cap} className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-4 px-4 py-2.5 text-[12px]">
                <span className="text-t1">
                  {(CAPABILITY_LABELS as Record<string, string>)[cap] ?? cap}
                </span>
                <span className="font-mono text-[11px] text-t2">
                  {ov ? ov.model : ai.activeModel}
                </span>
                <span className={`font-mono text-[10px] ${
                  ov ? 'text-[#B8952A]' : 'text-t5'
                }`}>
                  {ov ? 'overridden' : 'default'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Existing sections (kept for sidebar hash navigation) ── */}
      <div className="space-y-8">
        {/* Default gating — platform-wide entitlements every company inherits */}
        <section id="gating" className="space-y-4 scroll-mt-6">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <SlidersHorizontal className="h-4 w-4 text-t5" />Default gating
          </h2>
          <p className="text-[12px] text-t4">
            Platform-wide defaults inherited by every company that has no per-account override.
            Trial limits apply on the <span className="text-t2">trial</span> plan; unchecking a
            feature fences it off for all accounts.
          </p>
          <form action={saveDefaultGating} className={`${card} space-y-1 p-5`}>
            <EntitlementFields ent={platformDefaults} />
            <div className="flex justify-end pt-2">
              <button type="submit" className={btnPrimary}><Save className="h-4 w-4" />Save defaults</button>
            </div>
          </form>
        </section>

        {/* Companies */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Building2 className="h-4 w-4 text-t5" />Accounts
          </h2>
          {companies.map((c) => {
            const eff = resolveEntitlements(c.entitlements, platformDefaults);
            const isCustom = c.entitlements != null;
            return (
              <div key={c.id.toString()} className={`${card} p-4`}>
                <form action={updateCompany}>
                  <input type="hidden" name="companyId" value={c.id.toString()} />
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[13px] font-semibold text-t1">{c.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-t5">/{c.slug}</span>
                    </div>
                    <div className="font-mono text-[11px] text-t5">
                      {c._count.users} users · {c._count.solicitations} solicitations · {c._count.evaluations} evals
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Plan</label>
                      <select name="plan" defaultValue={c.plan} className={fieldClasses}>
                        {PLANS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Plan status</label>
                      <select name="planStatus" defaultValue={c.planStatus} className={fieldClasses}>
                        {PLAN_STATUSES.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Trial ends</label>
                      <input
                        name="trialEndsAt"
                        type="date"
                        defaultValue={c.trialEndsAt ? c.trialEndsAt.toISOString().slice(0, 10) : ''}
                        className={fieldClasses}
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Key mode</label>
                      <select name="aiKeyMode" defaultValue={c.aiKeyMode} className={fieldClasses}>
                        {KEY_MODES.map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Provider</label>
                      <select name="activeProvider" defaultValue={c.activeProvider} className={fieldClasses}>
                        {PROVIDERS.map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Model</label>
                      <input name="activeModel" type="text" defaultValue={c.activeModel} className={fieldClasses} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClasses}>Keys</label>
                      <div className="px-1 py-2 font-mono text-[11px] text-t4">
                        {[
                          ['A', secretHint(c.anthropicKeyEnc)],
                          ['O', secretHint(c.openaiKeyEnc)],
                          ['G', secretHint(c.googleKeyEnc)]
                        ]
                          .map(([k, h]) => `${k}:${h ? '✓' : '–'}`)
                          .join('  ')}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save account</button>
                  </div>
                </form>

                {/* Per-company entitlements override (opt-in; independent of the account save) */}
                <div className="mt-4 border-t border-line pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                      Entitlements{' '}
                      <span className={`normal-case ${isCustom ? 'text-[#92400E]' : 'text-t4'}`}>
                        · {isCustom ? 'custom override' : 'inheriting platform defaults'}
                      </span>
                    </div>
                    {isCustom && (
                      <form action={clearCompanyEntitlements}>
                        <input type="hidden" name="companyId" value={c.id.toString()} />
                        <button type="submit" className="font-mono text-[10px] uppercase tracking-wide text-t5 transition-colors hover:text-t2">
                          Reset to defaults
                        </button>
                      </form>
                    )}
                  </div>
                  <form action={updateCompanyEntitlements} className="space-y-1">
                    <input type="hidden" name="companyId" value={c.id.toString()} />
                    <EntitlementFields ent={eff} />
                    <div className="flex justify-end pt-2">
                      <button type="submit" className={btnGhost}><Save className="h-4 w-4" />Save overrides</button>
                    </div>
                  </form>
                </div>
              </div>
            );
          })}
        </section>

        {/* Users */}
        <section id="users" className="space-y-4 scroll-mt-6">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Users className="h-4 w-4 text-t5" />Users{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({users.length})</span>
          </h2>
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className={`${card} flex flex-wrap items-center gap-3 p-3`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] text-t1">{u.email}</span>
                    {!u.isActive && (
                      <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#991B1B]">
                        banned
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-t5">{u.company.name}</div>
                </div>

                {/* Role */}
                <form action={updateAnyUser} className="flex items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="role" defaultValue={u.role} className={`${fieldClasses} w-36`}>
                    {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </select>
                  <button type="submit" className={btnGhost} title="Save role">
                    <Save className="h-4 w-4" />
                  </button>
                </form>

                {/* Ban / unban */}
                <form action={toggleBan}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="banned" value={u.isActive ? '1' : '0'} />
                  <button
                    type="submit"
                    className={u.isActive ? btnGhost : btnPrimary}
                    title={u.isActive ? 'Ban (deactivate)' : 'Unban'}
                  >
                    <Ban className="h-4 w-4" />
                    {u.isActive ? 'Ban' : 'Unban'}
                  </button>
                </form>

                {/* Delete */}
                <form action={removeUser}>
                  <input type="hidden" name="userId" value={u.id} />
                  <ConfirmButton
                    message={`Permanently delete ${u.email}? This removes their account and login. This cannot be undone.`}
                    className={btnDanger}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        </section>

        {/* Application Admins */}
        <section id="admins" className="space-y-4 scroll-mt-6">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <ShieldCheck className="h-4 w-4 text-t5" />Administrators{' '}
            <span className="font-mono text-[11px] font-normal text-t5">({admins.length})</span>
          </h2>

          <form action={addAdmin} className={`${card} flex items-end gap-3 p-4`}>
            <div className="flex-1 space-y-1.5">
              <label className={labelClasses}>Grant application admin by email</label>
              <input
                name="email"
                type="email"
                placeholder="operator@crucibleinsight.com"
                className={fieldClasses}
                required
              />
            </div>
            <button type="submit" className={btnPrimary}>
              <Plus className="h-4 w-4" />Add admin
            </button>
          </form>

          <div className="space-y-2">
            {admins.map((a) => {
              const env = isEnvPlatformAdmin(a.email);
              const self = a.id === me.id;
              const locked = env || self;
              return (
                <div key={a.id.toString()} className={`${card} flex flex-wrap items-center gap-3 p-3`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-t1">{a.email}</span>
                      {env && (
                        <span className="rounded bg-navy/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-navy">
                          env-pinned
                        </span>
                      )}
                      {self && (
                        <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-t4">
                          you
                        </span>
                      )}
                      {!a.isActive && (
                        <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#991B1B]">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-t5">
                      {a.lastLoginAt
                        ? `Last sign-in ${a.lastLoginAt.toISOString().slice(0, 10)}`
                        : 'Never signed in'}
                      {a.addedBy ? ` · added by ${a.addedBy}` : ''}
                    </div>
                  </div>

                  {!locked && (
                    <>
                      <form action={toggleAdmin}>
                        <input type="hidden" name="adminId" value={a.id.toString()} />
                        <input type="hidden" name="active" value={a.isActive ? '0' : '1'} />
                        <button type="submit" className={btnGhost}>
                          {a.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </form>
                      <form action={removeAdmin}>
                        <input type="hidden" name="adminId" value={a.id.toString()} />
                        <ConfirmButton
                          message={`Remove application-admin access for ${a.email}?`}
                          className={btnDanger}
                        >
                          <Trash2 className="h-4 w-4" />Remove
                        </ConfirmButton>
                      </form>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
