import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, Building2, Users, ShieldCheck, Ban, Trash2, Plus } from 'lucide-react';
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
import PageHeader from '@/components/dara/PageHeader';
import ConfirmButton from '@/components/dara/ConfirmButton';
import {
  card,
  fieldClasses,
  labelClasses,
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

  return (
    <div className="mx-auto max-w-5xl fade">
      <PageHeader
        eyebrow="Platform"
        title="Application Admin"
        subtitle={`${companies.length} accounts · ${users.length} users · ${admins.length} admins`}
      />

      <div className="mb-6 rounded-lg border border-line bg-surf px-4 py-2.5 text-[12px] text-t4">
        Application admins manage accounts, users, and platform settings.{' '}
        <span className="text-t2">No access to company CUI</span> (solicitations,
        documents, evaluations).
      </div>

      <div className="space-y-8">
        {/* Companies */}
        <section className="space-y-4">
          <h2 className={`flex items-center gap-2 ${sectionTitle}`}>
            <Building2 className="h-4 w-4 text-t5" />Accounts
          </h2>
          {companies.map((c) => (
            <form key={c.id.toString()} action={updateCompany} className={`${card} p-4`}>
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
          ))}
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
                      <span className="rounded bg-[#5a1f1f]/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#e07d7d]">
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
                        <span className="rounded bg-[#3b6ef0]/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#6f9bf5]">
                          env-pinned
                        </span>
                      )}
                      {self && (
                        <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-t4">
                          you
                        </span>
                      )}
                      {!a.isActive && (
                        <span className="rounded bg-[#5a1f1f]/30 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#e07d7d]">
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
