import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

// DARA-007 (compensating control): make the CUI → commercial-LLM data boundary
// explicit wherever CUI is configured or egresses (AI settings, documents,
// "Run evaluation"). Copy is mode-aware. Update the platform-mode wording once a
// zero-data-retention agreement is in place for the platform keys.
export default function CuiBoundaryNotice({
  provider,
  mode
}: {
  provider: string;
  mode: string;
}) {
  const providerLabel =
    provider === 'anthropic' ? 'Anthropic' : provider === 'openai' ? 'OpenAI' : 'Google';
  const isByok = mode === 'byok';
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#5a4a1f]/60 bg-[#5a4a1f]/10 px-4 py-3 text-[12px] leading-relaxed text-[#e0c97d]">
      <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <div>
        <span className="font-semibold">CUI data boundary.</span> Evaluations send the extracted
        text of solicitation and proposal documents — potentially FCI/CUI — to{' '}
        <span className="font-semibold">{providerLabel}</span>, a commercial AI endpoint (not
        FedRAMP-authorized).{' '}
        {isByok
          ? 'You are using your own API key (BYOK) — your provider account’s data-handling and retention terms apply. Ensure zero data retention is configured for CUI.'
          : 'The DARA platform key processes data under DARA’s commercial account. For CUI, use BYOK with a zero-retention agreement, or confirm a zero-retention agreement covers the platform keys.'}{' '}
        <Link href="/app/security" className="underline hover:text-[#f0d9a0]">
          Details
        </Link>
        .
      </div>
    </div>
  );
}
