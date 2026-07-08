import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { Save, Building2, Users, ShieldCheck, Ban, Trash2, Plus, SlidersHorizontal } from 'lucide-react';
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
import PageHeader from '@/components/dara/PageHeader';
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

function pick(list: string[], val: string, fallback: string) {
  return list.includes(val) ? val : fallback;
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

  const companies = await prismaAdmin.company.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, solicitations: true, evaluations: true } }
    }
  });
  const users = await prismaAdmin.daraUser.findMany({
    orderBy: { createdAt: 'asc' },
    include: { company: { select: { name: true } } }
  });
  const admins = await listPlatformAdmins();
  const platformDefaults = await getPlatformDefaultEntitlements();

  return (
    <div>
      <PageHeader
        eyebrow="Platform"
        title="Application Admin"
        subtitle={`${companies.length} accounts · ${users.length} users · ${admins.length} admins`}
      />

      <div className="mb-6 rounded-lg border border-line bg-surf px-4 py-2.5 text-[12px] text-t4">
        Application admins manage accounts, users, and platform settings.{' '}
        <span className="text-t2">No access to company CUI</span> (solicitations,
        documents, evaluations). Background jobs, platform AI keys, and usage are on their own tabs.
      </div>

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
