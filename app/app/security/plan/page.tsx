import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileText, Boxes, Users, ShieldCheck, ListChecks } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { isPlatformAdmin } from '@/utils/dara/admin';
import PageHeader from '@/components/dara/PageHeader';
import { card, sectionTitle, badgeBase } from '@/components/dara/theme';
import {
  SSP,
  CONTROL_POSTURE,
  FINDINGS,
  type ControlStatus,
  type FindingStatus
} from '@/utils/dara/security-content';

const statusColor: Record<ControlStatus, string> = {
  Implemented: 'text-[#7de0a0]',
  Partial: 'text-[#e0c97d]',
  'Not implemented': 'text-[#e07d7d]',
  'Not applicable': 'text-[#3d5270]',
  Undetermined: 'text-[#7d97b3]'
};

const findingStatusBadge: Record<FindingStatus, string> = {
  Open: 'bg-[#5a1f1f]/30 text-[#e07d7d]',
  'In progress': 'bg-navy/20 text-navy',
  Remediated: 'bg-[#1f5a31]/30 text-[#7de0a0]',
  'Risk accepted': 'bg-[#1a2f4a] text-[#7d97b3]'
};

export default async function SecurityPlanPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  const canSeeDetail = isPlatformAdmin(user.email);

  // POA&M = everything not fully remediated.
  const poam = FINDINGS.filter((f) => f.status !== 'Remediated');

  return (
    <div className="mx-auto max-w-5xl fade">
      <Link
        href="/app/security"
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-t4 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Security
      </Link>

      <PageHeader
        eyebrow="Trust & Compliance"
        title="System Security Plan"
        subtitle={`${SSP.system} · ${SSP.version} · updated ${SSP.updated} · ${SSP.owner}`}
      />

      <div className="mb-6 rounded-lg border border-navy/30 bg-navy/10 px-4 py-3 text-[12px] leading-relaxed text-[#9fb8e8]">
        Living document. It describes the DARA system, its authorization boundary,
        and how each NIST SP 800-171 control family is implemented today. The
        findings register on the Security page is the Plan of Action &amp; Milestones
        (POA&amp;M). Not a formal certification or third-party attestation.
      </div>

      {/* 1. System overview */}
      <section className={`${card} mb-6 p-6`}>
        <h2 className={`mb-3 flex items-center gap-2 ${sectionTitle}`}>
          <FileText className="h-4 w-4 text-navy" />1. System Overview
        </h2>
        <p className="text-[13px] leading-relaxed text-t2">{SSP.overview}</p>
        <h3 className="mb-2 mt-4 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
          Data categories processed
        </h3>
        <ul className="space-y-1.5">
          {SSP.dataCategories.map((d) => (
            <li key={d} className="text-[12px] leading-relaxed text-t3">
              • {d}
            </li>
          ))}
        </ul>
      </section>

      {/* 2. Authorization boundary */}
      <section className="mb-6">
        <h2 className={`mb-3 flex items-center gap-2 ${sectionTitle}`}>
          <Boxes className="h-4 w-4 text-[#3d5270]" />2. Authorization Boundary
        </h2>
        <div className={`${card} overflow-hidden`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                {['Component', 'Role', 'Data handled'].map((h) => (
                  <th
                    key={h}
                    className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SSP.boundary.map((b) => (
                <tr key={b.component} className="border-t border-line align-top">
                  <td className="px-[18px] py-3 text-[12px] font-semibold text-t2">
                    {b.component}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] text-t3">{b.role}</td>
                  <td className="px-3.5 py-3 text-[12px] leading-relaxed text-t4">
                    {b.data}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Roles */}
      <section className="mb-6">
        <h2 className={`mb-3 flex items-center gap-2 ${sectionTitle}`}>
          <Users className="h-4 w-4 text-[#3d5270]" />3. Roles &amp; Responsibilities
        </h2>
        <div className={`${card} overflow-hidden`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                {['Role', 'Who', 'Responsibility'].map((h) => (
                  <th
                    key={h}
                    className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SSP.roles.map((r) => (
                <tr key={r.role} className="border-t border-line align-top">
                  <td className="px-[18px] py-3 text-[12px] font-semibold text-t2">
                    {r.role}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] text-t3">{r.who}</td>
                  <td className="px-3.5 py-3 text-[12px] leading-relaxed text-t4">
                    {r.responsibility}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Control implementation by family */}
      <section className="mb-6">
        <h2 className={`mb-3 flex items-center gap-2 ${sectionTitle}`}>
          <ShieldCheck className="h-4 w-4 text-[#3d5270]" />4. Control Implementation
          — NIST SP 800-171 Rev. 3
        </h2>
        <div className={`${card} overflow-hidden`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                <th className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Family
                </th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Status
                </th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">
                  Implementation
                </th>
              </tr>
            </thead>
            <tbody>
              {CONTROL_POSTURE.map((c) => (
                <tr key={c.code} className="border-t border-line align-top">
                  <td className="px-[18px] py-3">
                    <span className="text-[13px] font-semibold text-t2">{c.family}</span>
                    <span className="ml-2 font-mono text-[11px] text-t5">{c.code}</span>
                  </td>
                  <td
                    className={`px-3.5 py-3 text-[12px] font-semibold ${statusColor[c.status]}`}
                  >
                    {c.status}
                  </td>
                  <td className="px-3.5 py-3 text-[12px] leading-relaxed text-t4">
                    {c.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. POA&M */}
      <section>
        <h2 className={`mb-3 flex items-center gap-2 ${sectionTitle}`}>
          <ListChecks className="h-4 w-4 text-[#e0c97d]" />5. Plan of Action &amp;
          Milestones (POA&amp;M)
        </h2>
        {poam.length === 0 ? (
          <div className={`${card} p-5 text-[13px] text-t3`}>
            No open items — all findings remediated or risk-accepted.
          </div>
        ) : canSeeDetail ? (
          <div className={`${card} overflow-hidden`}>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surf3">
                  {['ID', 'Item', 'Status', 'Planned remediation', 'Window'].map((h) => (
                    <th
                      key={h}
                      className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {poam.map((f) => (
                  <tr key={f.id} className="border-t border-line align-top">
                    <td className="px-[18px] py-3 font-mono text-[11px] text-t5">{f.id}</td>
                    <td className="px-3.5 py-3 text-[12px] font-semibold text-t2">
                      {f.title}
                    </td>
                    <td className="px-3.5 py-3">
                      <span className={`${badgeBase} ${findingStatusBadge[f.status]}`}>
                        {f.status}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 text-[12px] leading-relaxed text-t4">
                      {f.remediation}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-[11px] text-t5">{f.window}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`${card} p-5 text-[13px] leading-relaxed text-t3`}>
            {poam.length} open or in-progress item{poam.length === 1 ? '' : 's'} tracked.
            Detailed remediation plans are restricted to platform administrators; see
            the{' '}
            <Link href="/app/security" className="text-navy underline">
              Security page
            </Link>
            .
          </div>
        )}
      </section>
    </div>
  );
}
