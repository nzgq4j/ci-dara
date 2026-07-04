import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — DARA',
  description: 'The terms governing use of the DARA platform by Crucible Insight LLC.'
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

export default function TermsOfServicePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight text-t1">Terms of Service</h1>
      <p className="mt-1 text-[12px] text-t5">Last updated: {UPDATED}</p>

      <div className="mt-5 rounded-lg border border-[#5a4a1f]/50 bg-[#5a4a1f]/10 px-4 py-3 text-[12px] leading-relaxed text-[#92400E]">
        This document is a working draft provided for transparency. It should be
        reviewed and finalized by legal counsel before being relied upon.
      </div>

      <Section title="1. Acceptance">
        <p>
          By accessing or using DARA (the “Service”), operated by Crucible Insight LLC
          (“Crucible Insight,” “we”), you agree to these Terms. If you use the Service
          on behalf of an organization, you represent that you are authorized to bind
          that organization.
        </p>
      </Section>

      <Section title="2. The Service">
        <p>
          DARA provides AI-assisted screening and evaluation of government
          solicitations and offeror proposals. Outputs are decision-support
          information, not legal, contracting, or source-selection advice.
        </p>
      </Section>

      <Section title="3. Accounts and eligibility">
        <p>
          You must provide accurate account information and keep your credentials
          secure. You are responsible for activity under your account and for managing
          your organization’s users and roles.
        </p>
      </Section>

      <Section title="4. Your data and responsibilities">
        <p>
          You retain ownership of the documents and content you upload. You are solely
          responsible for ensuring you have the right to upload that content,
          including any Federal Contract Information (FCI) or Controlled Unclassified
          Information (CUI), and for complying with your own contractual and
          regulatory obligations regarding its handling.
        </p>
        <p>
          You acknowledge that, to generate evaluations, document text is transmitted
          to the commercial AI provider you select (see the{' '}
          <Link href="/security/privacy-policy" className="text-navy underline">
            Privacy Policy
          </Link>
          ), and you are responsible for choosing platform or BYOK processing
          appropriate to the sensitivity of your content.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>
          Do not use the Service to violate law, infringe rights, attempt to access
          other organizations’ data, probe or disrupt the Service, or upload malware.
          Tenant isolation is enforced, but you must not attempt to circumvent it.
        </p>
      </Section>

      <Section title="6. AI outputs">
        <p>
          Evaluations are AI-generated and may be incomplete or incorrect. They
          require human review and must not be the sole basis for any award,
          determination, or other consequential decision. You are responsible for
          independently verifying outputs.
        </p>
      </Section>

      <Section title="7. Fees and billing">
        <p>
          Paid plans are billed through Stripe per the pricing presented in the app.
          Fees are non-refundable except as required by law or expressly stated.
        </p>
      </Section>

      <Section title="8. Confidentiality and security">
        <p>
          We apply administrative and technical safeguards described in our Privacy
          Policy and security program. No method of transmission or storage is
          completely secure, and we do not warrant absolute security.
        </p>
      </Section>

      <Section title="9. Disclaimers and limitation of liability">
        <p>
          The Service is provided “as is” without warranties of any kind. To the
          maximum extent permitted by law, Crucible Insight is not liable for indirect
          or consequential damages, and total liability is limited to the amounts you
          paid for the Service in the preceding twelve months.
        </p>
      </Section>

      <Section title="10. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate
          access for violation of these Terms or to protect the Service or its users.
        </p>
      </Section>

      <Section title="11. Changes and governing law">
        <p>
          We may update these Terms; continued use after changes constitutes
          acceptance. These Terms are governed by the laws of the United States and
          the state in which Crucible Insight is organized, without regard to conflict
          of laws.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>Questions about these Terms: islanista@gmail.com (Crucible Insight LLC).</p>
      </Section>
    </div>
  );
}
