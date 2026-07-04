import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — DARA',
  description: 'How DARA (Crucible Insight LLC) collects, uses, and protects data.'
};

const UPDATED = 'June 28, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-[16px] font-bold text-t1">{title}</h2>
      <div className="space-y-3 text-[13px] leading-relaxed text-t2">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-t1">Privacy Policy</h1>
      <p className="mt-1 text-[12px] text-t5">Last updated: {UPDATED}</p>

      <div className="mt-5 rounded-lg border border-[#5a4a1f]/50 bg-[#5a4a1f]/10 px-4 py-3 text-[12px] leading-relaxed text-[#e0c97d]">
        This document is a working draft provided for transparency. It should be
        reviewed and finalized by legal counsel before being relied upon.
      </div>

      <Section title="1. Who we are">
        <p>
          DARA is a document-analysis and proposal-evaluation platform operated by
          Crucible Insight LLC (“Crucible Insight,” “we,” “us”). This policy explains
          what data we process when you use the DARA application at
          dara.crucibleinsight.com and related services.
        </p>
      </Section>

      <Section title="2. Information we collect">
        <p>
          <strong>Account information</strong> — your name, email address, company
          name, role, and authentication identifiers (via Google sign-in or
          email/password through our authentication provider, Supabase).
        </p>
        <p>
          <strong>Content you upload</strong> — solicitation documents, offeror
          proposal documents, evaluation criteria, and personas you create. This
          content may include government Federal Contract Information (FCI) or
          Controlled Unclassified Information (CUI). You are responsible for ensuring
          you are authorized to upload it.
        </p>
        <p>
          <strong>Usage and audit data</strong> — records of security-relevant
          actions (sign-in, document upload/deletion, evaluation runs, configuration
          and access changes), including actor, timestamp, and the action performed.
        </p>
      </Section>

      <Section title="3. How we use information">
        <p>
          To provide and operate the service: authenticating you, isolating your
          organization’s data, running AI-assisted evaluations, billing, support, and
          maintaining security and audit trails. We do not sell your data.
        </p>
      </Section>

      <Section title="4. AI processing and subprocessors">
        <p>
          To produce evaluations, the extracted text of your documents is sent to a
          commercial large-language-model (LLM) provider you or your administrator
          select — Anthropic, OpenAI, or Google. In “platform” mode this is processed
          under Crucible Insight’s account; in “bring-your-own-key” (BYOK) mode it is
          processed under your own provider account and that provider’s terms.
        </p>
        <p>
          We are pursuing zero-data-retention arrangements with our platform
          providers. You can review the data boundary and use BYOK with your own
          zero-retention terms for sensitive content. Other subprocessors include
          Supabase (database, authentication, storage), Vercel (hosting), and Stripe
          (payments).
        </p>
      </Section>

      <Section title="5. Data retention">
        <p>
          We retain your account and content for as long as your account is active or
          as needed to provide the service. You may request deletion of your data;
          audit records may be retained as required for security and compliance.
        </p>
      </Section>

      <Section title="6. How we protect data">
        <p>
          Tenant data is isolated per organization with database row-level security
          under least-privilege roles. Document text (CUI) is encrypted at rest
          (AES-256-GCM) and in transit (TLS). BYOK API keys are encrypted at rest.
          Security-relevant actions are recorded in an append-only audit trail. Our
          security program is aligned to NIST SP 800-171 / CMMC objectives.
        </p>
      </Section>

      <Section title="7. Your choices and rights">
        <p>
          You can access and update your account information in the app, choose
          platform or BYOK AI processing, and request data export or deletion by
          contacting us. Depending on your jurisdiction, you may have additional
          rights over your personal data.
        </p>
      </Section>

      <Section title="8. Changes">
        <p>
          We may update this policy; material changes will be reflected by the “last
          updated” date above and, where appropriate, by notice in the app.
        </p>
      </Section>

      <Section title="9. Contact">
        <p>
          Questions about this policy or your data: islanista@gmail.com (Crucible
          Insight LLC). See also our{' '}
          <Link href="/security/tos" className="text-navy underline">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
