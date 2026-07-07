import Link from 'next/link';
import { ShieldCheck, FileText, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { isPlatformAdmin } from '@/utils/dara/admin';
import PageHeader from '@/components/dara/PageHeader';
import { card, sectionTitle, badgeBase } from '@/components/dara/theme';
import {
  ASSESSMENT,
  FRAMEWORKS,
  CONTROL_POSTURE,
  FINDINGS,
  POSITIVES,
  SEVERITY_ORDER,
  type Severity,
  type ControlStatus,
  type FindingStatus
} from '@/utils/dara/security-content';

// Public Security & Compliance page — no sign-in required. Detailed findings remain
// restricted to platform admins (the same gate the page used when it lived at
// /app/security); everyone else sees the summary. Moved out of /app 2026-07-07 so it can
// be linked from the sign-in page and shared with prospects.
export const dynamic = 'force-dynamic';

const severityBadge: Record<Severity, string> = {
  Critical: 'bg-[#FEE2E2] text-[#991B1B]',
  High: 'bg-[#FFEDD5] text-[#C05621]',
  Moderate: 'bg-[#FEF3C7] text-[#92400E]',
  Low: 'bg-navy/10 text-navy',
  Informational: 'bg-line text-t4'
};

const severityAccent: Record<Severity, string> = {
  Critical: '#991B1B',
  High: '#C05621',
  Moderate: '#92400E',
  Low: '#1D4ED8',
  Informational: '#7d97b3'
};

const statusColor: Record<ControlStatus, string> = {
  Implemented: 'text-[#166534]',
  Partial: 'text-[#92400E]',
  'Not implemented': 'text-[#991B1B]',
  'Not applicable': 'text-t5',
  Undetermined: 'text-t4'
};

const findingStatusBadge: Record<FindingStatus, string> = {
  Open: 'bg-[#FEE2E2] text-[#991B1B]',
  'In progress': 'bg-navy/20 text-navy',
  Remediated: 'bg-[#DCFCE7] text-[#166534]',
  'Risk accepted': 'bg-line text-t4'
};

export default async function SecurityPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const canSeeDetail = isPlatformAdmin(user?.email);

  const openFindings = FINDINGS.filter((f) => f.status !== 'Remediated');
  const remediatedCount = FINDINGS.length - openFindings.length;
  const counts = SEVERITY_ORDER.map((sev) => ({
    sev,
    n: openFindings.filter((f) => f.severity === sev).length
  })).filter((c) => c.n > 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-16 fade">
      <PageHeader
        eyebrow="Trust & Compliance"
        title="Security &amp; Compliance"
        subtitle="The standards DARA is built against and the results of our internal security assessment."
        action={
          <Link
            href="/app/security/plan"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-line px-4 py-2 text-sm font-medium text-t4 transition-colors hover:border-navy hover:text-t1"
          >
            <FileText className="h-4 w-4" />
            System Security Plan
          </Link>
        }
      />

      {/* Assessment summary */}
      <section className={`${card} mb-6 p-6`}>
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-navy" />
          <h2 className={sectionTitle}>{ASSESSMENT.title}</h2>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {[
            ['Assessment date', ASSESSMENT.performed],
            ['Performed by', ASSESSMENT.assessor],
            ['Scope', ASSESSMENT.scope],
            ['Method', ASSESSMENT.method],
            ['Evidence standard', ASSESSMENT.evidenceStandard]
          ].map(([label, value]) => (
            <div key={label} className={label === 'Scope' || label === 'Method' || label === 'Evidence standard' ? 'sm:col-span-2' : ''}>
              <dt className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                {label}
              </dt>
              <dd className="text-[13px] leading-relaxed text-t2">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Severity summary (open findings) */}
      <div className="mb-8 grid grid-cols-2 gap-3.5 sm:grid-cols-4 lg:grid-cols-5">
        {counts.map(({ sev, n }) => (
          <div
            key={sev}
            className="rounded-[10px] border border-line bg-surf p-4"
            style={{ borderTop: `3px solid ${severityAccent[sev]}` }}
          >
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
              {sev} open
            </div>
            <div className="text-3xl font-bold leading-none" style={{ color: severityAccent[sev] }}>
              {n}
            </div>
          </div>
        ))}
        <div
          className="rounded-[10px] border border-line bg-surf p-4"
          style={{ borderTop: '3px solid #166534' }}
        >
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
            Remediated
          </div>
          <div className="text-3xl font-bold leading-none text-[#166534]">{remediatedCount}</div>
        </div>
      </div>

      {/* Standards & frameworks */}
      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-t5" />
          <h2 className={sectionTitle}>Standards &amp; Frameworks</h2>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          {FRAMEWORKS.map((fw) => (
            <div key={fw.code} className={`${card} p-5`}>
              <div className="mb-1 flex items-start justify-between gap-3">
                <div className="text-[14px] font-bold text-t1">{fw.code}</div>
                <span className={`${badgeBase} bg-navy/15 text-navy`}>{fw.scope}</span>
              </div>
              <div className="mb-2 text-[12px] font-semibold text-t3">{fw.name}</div>
              <p className="text-[12px] leading-relaxed text-t4">{fw.summary}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Control posture */}
      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-4 w-4 text-t5" />
          <h2 className={sectionTitle}>Control Posture — NIST SP 800-171 Rev. 3 Families</h2>
        </div>
        <div className={`${card} overflow-hidden`}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surf3">
                <th className="px-[18px] py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">Family</th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">Status</th>
                <th className="px-3.5 py-2.5 font-mono text-[10px] uppercase tracking-wide text-t5">Observation</th>
              </tr>
            </thead>
            <tbody>
              {CONTROL_POSTURE.map((c) => (
                <tr key={c.code} className="border-t border-line">
                  <td className="px-[18px] py-3 align-top">
                    <span className="text-[13px] font-semibold text-t2">{c.family}</span>
                    <span className="ml-2 font-mono text-[11px] text-t5">{c.code}</span>
                  </td>
                  <td className={`px-3.5 py-3 align-top text-[12px] font-semibold ${statusColor[c.status]}`}>
                    {c.status}
                  </td>
                  <td className="px-3.5 py-3 align-top text-[12px] leading-relaxed text-t4">
                    {c.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Strengths */}
      <section className="mb-8">
        <div className="mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-[#166534]" />
          <h2 className={sectionTitle}>Verified Strengths</h2>
        </div>
        <div className={`${card} p-5`}>
          <ul className="space-y-2.5">
            {POSITIVES.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-t2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#166534]" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Findings register */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#92400E]" />
          <h2 className={sectionTitle}>Assessment Findings</h2>
        </div>

        {canSeeDetail ? (
          <div className="space-y-3.5">
            {FINDINGS.map((f) => (
              <div
                key={f.id}
                className={`${card} p-5`}
                style={{ borderLeft: `3px solid ${severityAccent[f.severity]}` }}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-t5">{f.id}</span>
                  <span className={`${badgeBase} ${severityBadge[f.severity]}`}>{f.severity}</span>
                  <span className={`${badgeBase} ${findingStatusBadge[f.status]}`}>{f.status}</span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                    {f.window}
                  </span>
                </div>
                <h3 className="mb-2 text-[14px] font-bold text-t1">{f.title}</h3>
                <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {[
                    ['Component', f.component],
                    ['Evidence', f.evidence],
                    ['Impact', f.impact],
                    ['Remediation', f.remediation],
                    ['Control mapping', f.mapping]
                  ].map(([label, value]) => (
                    <div key={label} className={label === 'Component' || label === 'Control mapping' ? '' : 'sm:col-span-2'}>
                      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                        {label}
                      </div>
                      <div className="text-[12px] leading-relaxed text-t2">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`${card} p-6`}>
            <p className="mb-4 text-[13px] leading-relaxed text-t2">
              A point-in-time assessment was completed on {ASSESSMENT.performed}. Findings
              are tracked and remediated on the schedule below. Detailed technical
              findings are restricted to platform administrators.
            </p>
            <div className="flex flex-wrap gap-2">
              {counts.map(({ sev, n }) => (
                <span key={sev} className={`${badgeBase} ${severityBadge[sev]}`}>
                  {n} {sev}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <p className="mt-8 text-[11px] leading-relaxed text-t5">
        This page reflects an internal, evidence-based review and is not a formal
        certification or third-party attestation. Items that could not be confirmed
        from the codebase are treated as unverified rather than compliant.
      </p>
    </div>
  );
}
