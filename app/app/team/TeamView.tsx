'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, MoreHorizontal, X, UserPlus, Mail, Check, Ban } from 'lucide-react';
import PageHeader from '@/components/dara/PageHeader';
import { card, fieldClasses, labelClasses, btnPrimary, btnGhost } from '@/components/dara/theme';
import {
  inviteUser,
  createDepartment,
  deleteDepartment,
  setUserRole,
  setUserDepartment,
  setUserActive,
  revokeInvitation
} from './actions';

export interface DeptItem {
  id: string;
  name: string;
  userCount: number;
}
export interface MemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
  lastActive: string;
  isSelf: boolean;
}
export interface InviteItem {
  id: string;
  email: string;
  role: string;
  departmentName: string | null;
  expires: string;
}

const ROLES = ['company_admin', 'dept_admin', 'manager', 'reviewer'] as const;
const ROLE_LABEL: Record<string, string> = {
  company_admin: 'Company Admin',
  dept_admin: 'Dept Admin',
  manager: 'Manager',
  reviewer: 'Reviewer'
};
const ROLE_BADGE: Record<string, string> = {
  company_admin: 'bg-[#ef4444]/15 text-[#ef4444]',
  dept_admin: 'bg-[#8b5cf6]/15 text-[#8b5cf6]',
  manager: 'bg-[#10b981]/15 text-[#10b981]',
  reviewer: 'bg-[#3b6ef0]/15 text-[#6f9bf5]'
};
const AVATAR_COLORS = ['#6366f1', '#10b981', '#3b6ef0', '#f59e0b', '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444'];
const DEPT_DOTS = ['#3b6ef0', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

function hashIndex(s: string, n: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}
function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] || '?').toUpperCase();
}

function Badge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wide ${ROLE_BADGE[role] ?? 'bg-line text-t4'}`}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`${card} relative z-10 w-full max-w-md p-6 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-t1">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-t5 hover:text-t1"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TeamView({
  companyName,
  departments,
  members,
  invites
}: {
  companyName: string;
  departments: DeptItem[];
  members: MemberItem[];
  invites: InviteItem[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shown = filter ? members.filter((m) => m.departmentId === filter) : members;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
      setMenuFor(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl fade">
      <PageHeader
        title="Team"
        subtitle={`Manage users, roles, and departments for ${companyName}.`}
        action={
          <button onClick={() => setInviteOpen(true)} className={btnPrimary}>
            <Plus className="h-4 w-4" />Invite User
          </button>
        }
      />

      {/* Departments */}
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-t5">Departments</div>
      <div className="mb-7 flex flex-wrap gap-3">
        {departments.map((d, i) => {
          const active = filter === d.id;
          return (
            <button
              key={d.id}
              onClick={() => setFilter(active ? null : d.id)}
              className={`group flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors ${
                active ? 'border-[#3b6ef0] bg-[#3b6ef0]/5' : 'border-line bg-surf hover:border-[#3b6ef0]/40'
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DEPT_DOTS[i % DEPT_DOTS.length] }} />
              <span className="text-[13px] font-semibold text-t1">{d.name}</span>
              <span className="font-mono text-[11px] text-t5">{d.userCount} user{d.userCount === 1 ? '' : 's'}</span>
              {active && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete department "${d.name}"? Members are not deleted.`)) run(() => deleteDepartment(d.id)); }}
                  className="ml-1 rounded p-0.5 text-t5 hover:text-[#e07d7d]"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setDeptOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-line px-4 py-3 text-[13px] text-t4 transition-colors hover:border-[#3b6ef0]/50 hover:text-t1"
        >
          <Plus className="h-4 w-4" />New Department
        </button>
      </div>

      {/* Users table */}
      <div className={`${card} overflow-visible`}>
        <div className="grid grid-cols-[1fr_150px_160px_130px_40px] items-center gap-3 border-b border-line px-5 py-3">
          {['User', 'Role', 'Department', 'Last Active', ''].map((h, i) => (
            <div key={i} className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">{h}</div>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-t4">No users{filter ? ' in this department' : ''} yet.</div>
        ) : (
          shown.map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_150px_160px_130px_40px] items-center gap-3 border-b border-line px-5 py-4 last:border-b-0">
              {/* User */}
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: AVATAR_COLORS[hashIndex(m.id, AVATAR_COLORS.length)] }}
                >
                  {initials(m.name, m.email)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-t1">{m.name}</span>
                    {!m.isActive && <span className="rounded bg-line px-1.5 py-0.5 font-mono text-[9px] uppercase text-t5">inactive</span>}
                    {m.isSelf && <span className="font-mono text-[10px] text-t5">you</span>}
                  </div>
                  <div className="truncate text-[12px] text-t5">{m.email}</div>
                </div>
              </div>
              {/* Role */}
              <div><Badge role={m.role} /></div>
              {/* Department */}
              <div className="truncate text-[13px] text-t3">{m.departmentName ?? <span className="text-t5">—</span>}</div>
              {/* Last active */}
              <div className="text-[12px] text-t4">{m.lastActive}</div>
              {/* Menu */}
              <div className="relative flex justify-end">
                <button
                  onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                  className="rounded p-1.5 text-t5 transition-colors hover:bg-line hover:text-t1"
                  aria-label="Member actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuFor === m.id && (
                  <RowMenu
                    member={m}
                    departments={departments}
                    busy={busy}
                    onClose={() => setMenuFor(null)}
                    onRole={(r) => run(() => setUserRole(m.id, r))}
                    onDept={(t) => run(() => setUserDepartment(m.id, t))}
                    onActive={(a) => run(() => setUserActive(m.id, a))}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pending invitations */}
      {invites.length > 0 && (
        <div className="mt-7">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-t5">
            Pending invitations ({invites.length})
          </div>
          <div className={`${card} divide-y divide-line`}>
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                <Mail className="h-4 w-4 shrink-0 text-t5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-t1">{inv.email}</div>
                  <div className="truncate text-[11px] text-t5">
                    {inv.departmentName ?? 'no department'} · expires {inv.expires}
                  </div>
                </div>
                <Badge role={inv.role} />
                <button onClick={() => run(() => revokeInvitation(inv.id))} className={btnGhost} disabled={busy}>
                  <X className="h-4 w-4" />Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {inviteOpen && (
        <InviteModal departments={departments} onClose={() => setInviteOpen(false)} onDone={() => { setInviteOpen(false); router.refresh(); }} />
      )}
      {deptOpen && (
        <DeptModal onClose={() => setDeptOpen(false)} onDone={() => { setDeptOpen(false); router.refresh(); }} />
      )}
    </div>
  );
}

function RowMenu({
  member,
  departments,
  busy,
  onClose,
  onRole,
  onDept,
  onActive
}: {
  member: MemberItem;
  departments: DeptItem[];
  busy: boolean;
  onClose: () => void;
  onRole: (r: string) => void;
  onDept: (t: string | null) => void;
  onActive: (a: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  return (
    <div ref={ref} className={`${card} absolute right-0 top-9 z-20 w-56 p-3 shadow-xl`}>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className={labelClasses}>Role</label>
          <select
            defaultValue={member.role}
            disabled={busy || member.isSelf}
            onChange={(e) => onRole(e.target.value)}
            className={fieldClasses}
          >
            {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
          </select>
          {member.isSelf && <p className="text-[10px] text-t5">You can&apos;t change your own role.</p>}
        </div>
        <div className="space-y-1">
          <label className={labelClasses}>Department</label>
          <select
            defaultValue={member.departmentId ?? ''}
            disabled={busy}
            onChange={(e) => onDept(e.target.value || null)}
            className={fieldClasses}
          >
            <option value="">— none —</option>
            {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
          </select>
        </div>
        {!member.isSelf && (
          <button
            onClick={() => onActive(!member.isActive)}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-t3 transition-colors hover:border-[#3b6ef0]/40 hover:text-t1"
          >
            {member.isActive ? <><Ban className="h-3.5 w-3.5" />Deactivate</> : <><Check className="h-3.5 w-3.5" />Activate</>}
          </button>
        )}
      </div>
    </div>
  );
}

function InviteModal({
  departments,
  onClose,
  onDone
}: {
  departments: DeptItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reviewer');
  const [dept, setDept] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await inviteUser(email, role, dept || null);
    setBusy(false);
    if (res.ok) onDone();
    else setErr(res.error ?? 'Could not send invite.');
  }

  return (
    <Modal title="Invite user" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className={labelClasses}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" className={fieldClasses} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className={labelClasses}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={fieldClasses}>
              {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABEL[r]}</option>))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelClasses}>Department</label>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className={fieldClasses}>
              <option value="">— none —</option>
              {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
          </div>
        </div>
        {err && <p className="text-[12px] text-[#e07d7d]">{err}</p>}
        <p className="text-[11px] text-t5">They join on first sign-in. An invite email is sent if Supabase Auth is configured.</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost} disabled={busy}>Cancel</button>
          <button onClick={submit} className={btnPrimary} disabled={busy}>
            <UserPlus className="h-4 w-4" />{busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeptModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await createDepartment(name, description || null);
    setBusy(false);
    if (res.ok) onDone();
    else setErr(res.error ?? 'Could not create department.');
  }

  return (
    <Modal title="New department" onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className={labelClasses}>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Contracts" className={fieldClasses} autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className={labelClasses}>Description (optional)</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this department does" className={fieldClasses} />
        </div>
        {err && <p className="text-[12px] text-[#e07d7d]">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost} disabled={busy}>Cancel</button>
          <button onClick={submit} className={btnPrimary} disabled={busy}>
            <Plus className="h-4 w-4" />{busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
