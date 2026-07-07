import { Metadata } from 'next';
import Tabs, { type TabDef } from '@/components/dara/Tabs';
import PublicChrome from '@/components/dara/PublicChrome';

export const metadata: Metadata = {
  title: 'Legal — DARA',
  description: 'Terms of Service and Privacy Policy for the DARA platform (The Daniel Group LLC d/b/a Crucible Insight).'
};

const UPDATED = 'July 7, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[16px] font-bold text-t1">{title}</h2>
      <div className="space-y-3 text-[13px] leading-relaxed text-t2">{children}</div>
    </section>
  );
}

function TermsOfService() {
  return (
    <div>
      <p className="text-[12px] text-t5">Last updated: {UPDATED}</p>

      <Section title="1. Acceptance">
        <p>
          By accessing or using DARA (the “Service”), operated by The Daniel Group LLC
          d/b/a Crucible Insight (“Crucible Insight,” “we”), you agree to these Terms. If
          you use the Service on behalf of an organization, you represent that you are
          authorized to bind that organization.
        </p>
      </Section>

      <Section title="2. The Service">
        <p>
          DARA provides AI-assisted screening and evaluation of government solicitations
          and proposal drafts. Outputs are decision-support information, not legal,
          contracting, or source-selection advice.
        </p>
      </Section>

      <Section title="3. Accounts and eligibility">
        <p>
          You must provide accurate account information and keep your credentials secure.
          You are responsible for activity under your account and for managing your
          organization&apos;s users and roles.
        </p>
      </Section>

      <Section title="4. Your data and responsibilities">
        <p>
          You retain ownership of the documents and content you upload. You are solely
          responsible for ensuring you have the right to upload that content, and for
          complying with your own contractual and regulatory obligations regarding its
          handling.
        </p>
        <p>
          You acknowledge that, to generate evaluations, document text is transmitted to
          the commercial AI provider you select (see the Privacy Policy tab), and you are
          responsible for choosing platform or BYOK processing appropriate to the
          sensitivity of your content.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>
          Do not use the Service to violate law, infringe rights, attempt to access other
          organizations&apos; data, probe or disrupt the Service, or upload malware. Tenant
          isolation is enforced, but you must not attempt to circumvent it.
        </p>
      </Section>

      <Section title="6. AI outputs">
        <p>
          Evaluations are AI-generated and may be incomplete or incorrect. They require
          human review and must not be the sole basis for any award, determination, or
          other consequential decision. You are responsible for independently verifying
          outputs.
        </p>
      </Section>

      <Section title="7. Fees and billing">
        <p>
          Paid plans are billed through Stripe per the pricing presented in the app. Fees
          are non-refundable except as required by law or expressly stated.
        </p>
      </Section>

      <Section title="8. Confidentiality and security">
        <p>
          We apply administrative and technical safeguards described in our Privacy
          Policy and security program. No method of transmission or storage is completely
          secure, and we do not warrant absolute security.
        </p>
      </Section>

      <Section title="9. Disclaimers and limitation of liability">
        <p>
          The Service is provided “as is” without warranties of any kind. To the maximum
          extent permitted by law, Crucible Insight is not liable for indirect or
          consequential damages, and total liability is limited to the amounts you paid
          for the Service in the preceding twelve months.
        </p>
      </Section>

      <Section title="10. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access
          for violation of these Terms or to protect the Service or its users.
        </p>
      </Section>

      <Section title="11. Changes and governing law">
        <p>
          We may update these Terms; continued use after changes constitutes acceptance.
          These Terms are governed by the laws of the State of Arizona, without regard to
          conflict of laws.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>Questions about these Terms: admin@crucibleinsight.com.</p>
      </Section>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <div>
      <p className="text-[12px] text-t5">Last updated: {UPDATED}</p>

      <Section title="1. Who we are">
        <p>
          DARA is a document-analysis and proposal-evaluation platform operated by The
          Daniel Group LLC d/b/a Crucible Insight (“Crucible Insight,” “we,” “us”). This
          policy explains what data we process when you use the DARA application at
          dara.crucibleinsight.com and related services.
        </p>
      </Section>

      <Section title="2. Information we collect">
        <p>
          <strong>Account information</strong> — your name, email address, company name,
          role, and authentication identifiers (via Google sign-in or email/password
          through our authentication provider, Supabase).
        </p>
        <p>
          <strong>Content you upload</strong> — solicitation documents, proposal
          documents, evaluation criteria, and personas you create. You are responsible
          for ensuring you are authorized to upload this content.
        </p>
        <p>
          <strong>Usage and audit data</strong> — records of security-relevant actions
          (sign-in, document upload/deletion, evaluation runs, configuration and access
          changes), including actor, timestamp, and the action performed.
        </p>
      </Section>

      <Section title="3. How we use information">
        <p>
          To provide and operate the service: authenticating you, isolating your
          organization&apos;s data, running AI-assisted evaluations, billing, support, and
          maintaining security and audit trails. We do not sell your data.
        </p>
      </Section>

      <Section title="4. AI processing and subprocessors">
        <p>
          To produce evaluations, the extracted text of your documents is sent to a
          commercial large-language-model (LLM) provider you or your administrator
          select — Anthropic, OpenAI, or Google. In “platform” mode this is processed
          under Crucible Insight&apos;s account; in “bring-your-own-key” (BYOK) mode it is
          processed under your own provider account and that provider&apos;s terms.
        </p>
        <p>
          Other subprocessors include Supabase (database, authentication, storage),
          Vercel (hosting), Resend (email delivery), and Stripe (payments).
        </p>
      </Section>

      <Section title="5. Data retention">
        <p>
          We retain your account and content for as long as your account is active or as
          needed to provide the service. You may request deletion of your data; audit
          records may be retained as required for security and compliance.
        </p>
      </Section>

      <Section title="6. How we protect data">
        <p>
          Tenant data is isolated per organization with database row-level security
          under least-privilege roles. Document text is encrypted at rest (AES-256-GCM)
          and in transit (TLS). BYOK API keys are encrypted at rest. Security-relevant
          actions are recorded in an append-only audit trail. Our security program is
          aligned to NIST SP 800-171 / CMMC objectives — see the Security &amp;
          Compliance page.
        </p>
      </Section>

      <Section title="7. Your choices and rights">
        <p>
          You can access and update your account information in the app (Settings →
          Profile), choose platform or BYOK AI processing, and request data export or
          deletion by contacting us. Depending on your jurisdiction, you may have
          additional rights over your personal data.
        </p>
      </Section>

      <Section title="8. Changes">
        <p>
          We may update this policy; material changes will be reflected by the “last
          updated” date above and, where appropriate, by notice in the app.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>Questions about this policy or your data: admin@crucibleinsight.com.</p>
      </Section>
    </div>
  );
}

export default function LegalPage({
  searchParams
}: {
  searchParams: { tab?: string };
}) {
  const tabs: TabDef[] = [
    { id: 'tos', label: 'Terms of Service', content: <TermsOfService /> },
    { id: 'privacy', label: 'Privacy Policy', content: <PrivacyPolicy /> }
  ];
  const initial = tabs.some((t) => t.id === searchParams?.tab) ? searchParams!.tab : 'tos';

  return (
    <PublicChrome>
    <div className="mx-auto max-w-3xl px-6 py-16">
      {/* Best-effort print block — a browser can never be fully stopped from printing or
          screenshotting, but this keeps the page from rendering in the print preview. */}
      <style>{`
        @media print {
          .legal-print-guard { display: none !important; }
          .legal-print-notice { display: block !important; }
        }
      `}</style>
      <div className="legal-print-notice hidden text-sm">
        This document is for online viewing only and is not available for printing.
        Please visit dara.crucibleinsight.com/legal.
      </div>

      <div className="legal-print-guard">
        <h1 className="text-2xl font-bold tracking-tight text-t1">Legal</h1>
        <p className="mt-1 text-[13px] text-t4">
          Terms of Service and Privacy Policy for the DARA platform.
        </p>
        <div className="mt-6">
          <Tabs tabs={tabs} initial={initial} />
        </div>
      </div>
    </div>
    </PublicChrome>
  );
}
