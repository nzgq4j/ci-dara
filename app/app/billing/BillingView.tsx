import { Check, CreditCard, ExternalLink, Calendar, AlertTriangle, Download, Clock } from 'lucide-react';
import type { Company } from '@prisma/client';
import { PLAN_CATALOG, type PaidPlan, type BillingOverview } from '@/utils/dara/billing';
import type { TrialUsageItem } from '@/utils/dara/trial';

type TrialUsage = { trialEndsAt: Date | null; items: TrialUsageItem[] };
import { card, btnPrimary, btnGhost } from '@/components/dara/theme';
import { createCheckout, manageBilling } from './actions';

const TRIAL_LABELS: Record<string, string> = {
  solicitation: 'Solicitations',
  review_run: 'AI reviews',
  seat: 'Team seats'
};

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Base',
  pro: 'Pro',
  enterprise: 'Enterprise'
};

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
}

function daysUntil(d: Date | null): number | null {
  return d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : null;
}

// Billing tab content under Settings. Extracted from the former standalone /app/billing
// page (see actions.ts for the paired server actions) so it can be composed as one of
// several tabs; /app/billing itself now just redirects here.
export default function BillingView({
  company,
  overview,
  trial,
  success
}: {
  company: Company;
  overview: BillingOverview | null;
  trial: TrialUsage | null;
  success?: string;
}) {
  const currentPlan = company.plan;
  const currentLabel = PLAN_LABELS[currentPlan] ?? currentPlan;
  const plans = Object.entries(PLAN_CATALOG) as [PaidPlan, (typeof PLAN_CATALOG)[PaidPlan]][];

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-[13px] text-t4">
          Current plan: <span className="text-t1">{currentLabel}</span> ({company.planStatus})
        </p>
        {company.stripeCustomerId && (
          <form action={manageBilling}>
            <button type="submit" className={btnGhost}>
              <CreditCard className="h-4 w-4" />
              Manage billing
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>

      {success && (
        <div className="mb-6 rounded-lg border border-[#166534]/30 bg-[#DCFCE7] px-4 py-3 text-[13px] text-[#166534]">
          Subscription updated. If your plan doesn&apos;t reflect the change yet,
          it will once Stripe confirms the payment (via webhook).
        </div>
      )}

      {/* Live subscription summary (paid plans) */}
      {overview && (
        <div className={`${card} mb-6 p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-t1">Subscription</h2>
            <StatusPill status={overview.status} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Detail
              icon={<Calendar className="h-4 w-4" />}
              label={overview.cancelAtPeriodEnd ? 'Access ends' : 'Next billing date'}
              value={fmtDate(overview.nextBillingDate)}
              sub={
                (() => {
                  const d = daysUntil(overview.nextBillingDate);
                  return d != null ? `in ${d} day${d === 1 ? '' : 's'}` : undefined;
                })()
              }
            />
            <Detail
              icon={<CreditCard className="h-4 w-4" />}
              label={overview.cancelAtPeriodEnd ? 'Renewal' : 'Next charge'}
              value={
                overview.cancelAtPeriodEnd
                  ? 'Cancels — will not renew'
                  : overview.upcoming
                    ? money(overview.upcoming.amountDue, overview.upcoming.currency)
                    : overview.renewalAmount != null
                      ? `$${overview.renewalAmount}/${overview.interval ?? 'mo'}`
                      : '—'
              }
              sub={
                overview.upcoming && (overview.upcoming.discount > 0 || overview.upcoming.accountCredit > 0)
                  ? `was ${money(overview.upcoming.subtotal, overview.upcoming.currency)}`
                  : overview.upcoming && overview.interval
                    ? `per ${overview.interval}`
                    : undefined
              }
            />
            <Detail
              icon={<CreditCard className="h-4 w-4" />}
              label="Payment method"
              value={
                overview.paymentMethod
                  ? `${cap(overview.paymentMethod.brand)} ···· ${overview.paymentMethod.last4}`
                  : 'None on file'
              }
              sub={
                overview.paymentMethod
                  ? `Expires ${String(overview.paymentMethod.expMonth).padStart(2, '0')}/${overview.paymentMethod.expYear}`
                  : undefined
              }
            />
          </div>
          {overview.upcoming &&
            (overview.upcoming.discount > 0 || overview.upcoming.accountCredit > 0 || overview.upcoming.tax > 0) && (
              <dl className="mt-4 space-y-1 rounded-md border border-line bg-bg px-3.5 py-2.5 text-[12px]">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.07em] text-t5">
                  Next invoice{overview.upcoming.chargeDate ? ` · ${fmtDate(overview.upcoming.chargeDate)}` : ''}
                </div>
                <Line label="Subtotal" value={money(overview.upcoming.subtotal, overview.upcoming.currency)} />
                {overview.upcoming.discount > 0 && (
                  <Line label="Discount" value={`− ${money(overview.upcoming.discount, overview.upcoming.currency)}`} accent />
                )}
                {overview.upcoming.tax > 0 && (
                  <Line label="Tax" value={money(overview.upcoming.tax, overview.upcoming.currency)} />
                )}
                {overview.upcoming.accountCredit > 0 && (
                  <Line label="Account credit" value={`− ${money(overview.upcoming.accountCredit, overview.upcoming.currency)}`} accent />
                )}
                <div className="mt-1 border-t border-line pt-1">
                  <Line label="Total due" value={money(overview.upcoming.amountDue, overview.upcoming.currency)} strong />
                </div>
              </dl>
            )}

          {overview.cancelAtPeriodEnd && (
            <p className="mt-4 flex items-center gap-2 rounded-md border border-[#92400E]/25 bg-[#FEF3C7] px-3 py-2 text-[12px] text-[#92400E]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Your subscription is set to cancel and will not renew. Reactivate anytime under
              &ldquo;Manage billing.&rdquo;
            </p>
          )}
        </div>
      )}

      {/* Trial status (trial plans) */}
      {trial && (
        <div className={`${card} mb-6 p-5`}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-t1">Trial status</h2>
            {trial.trialEndsAt &&
              (() => {
                const d = daysUntil(trial.trialEndsAt);
                const expired = d != null && d < 0;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold ${
                      expired ? 'bg-[#FEE2E2] text-[#991B1B]' : 'bg-[#FEF3C7] text-[#92400E]'
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {expired ? 'Trial expired' : `${d} day${d === 1 ? '' : 's'} left`}
                  </span>
                );
              })()}
          </div>
          {trial.trialEndsAt && (
            <p className="mb-4 text-[12px] text-t4">Trial ends {fmtDate(trial.trialEndsAt)}. Choose a plan below to continue without interruption.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {trial.items.map((it) => {
              const pct = it.limit > 0 ? Math.min(100, Math.round((it.used / it.limit) * 100)) : 0;
              const full = it.used >= it.limit;
              return (
                <div key={it.resource} className="rounded-lg border border-line bg-bg p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-medium text-t3">{TRIAL_LABELS[it.resource]}</span>
                    <span className={`font-mono text-[12px] font-semibold ${full ? 'text-[#991B1B]' : 'text-t2'}`}>
                      {it.used}/{it.limit}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-line">
                    <div className={`h-full rounded ${full ? 'bg-[#991B1B]' : 'bg-navy'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map(([plan, info]) => {
          const isCurrent = currentPlan === plan;
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-[10px] border bg-surf p-5 ${
                isCurrent ? 'border-navy ring-1 ring-navy/40' : 'border-line'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-t1">{info.name}</h3>
                {isCurrent && (
                  <span className="rounded bg-navy/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-navy">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-3 text-3xl font-bold leading-none text-t1">
                ${info.amount}
                <span className="text-[13px] font-normal text-t4">/mo</span>
              </div>
              <p className="mt-2 text-[13px] text-t4">{info.blurb}</p>
              <div className="mt-5 flex-1" />
              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="w-full cursor-default rounded-lg border border-line px-3 py-2 text-[13px] font-medium text-t4"
                >
                  Active plan
                </button>
              ) : (
                <form action={createCheckout}>
                  <input type="hidden" name="plan" value={plan} />
                  <button type="submit" className={`${btnPrimary} w-full`}>
                    <Check className="h-4 w-4" />
                    Choose {info.name}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {/* Invoice history (from Stripe) */}
      {overview && overview.invoices.length > 0 && (
        <div className={`${card} mt-6 overflow-hidden`}>
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-bold text-t1">Billing history</h2>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="bg-surf3">
                <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Date</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Amount</th>
                <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-t5">Status</th>
                <th className="px-5 py-2 text-right font-mono text-[10px] uppercase tracking-wide text-t5">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {overview.invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-line">
                  <td className="px-5 py-2.5 text-t3">{fmtDate(inv.date)}</td>
                  <td className="px-3 py-2.5 font-medium text-t2">
                    ${inv.amount.toFixed(2)} <span className="uppercase text-t5">{inv.currency}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${
                        inv.status === 'paid'
                          ? 'bg-[#DCFCE7] text-[#166534]'
                          : inv.status === 'open'
                            ? 'bg-[#FEF3C7] text-[#92400E]'
                            : 'bg-line text-t4'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {inv.pdfUrl || inv.hostedUrl ? (
                      <a
                        href={(inv.pdfUrl || inv.hostedUrl) as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-navy hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </a>
                    ) : (
                      <span className="text-t5">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-[12px] text-t5">
        Have a coupon? You can enter a promotion code on the Stripe checkout page.
        Subscriptions are billed monthly; manage or cancel anytime via &ldquo;Manage
        billing&rdquo;.
      </p>
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <div className="flex items-center gap-1.5 text-t5">
        {icon}
        <span className="font-mono text-[10px] uppercase tracking-[0.07em]">{label}</span>
      </div>
      <div className="mt-1 text-[15px] font-semibold text-t1">{value}</div>
      {sub && <div className="text-[11px] text-t5">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === 'active'
      ? 'bg-[#DCFCE7] text-[#166534]'
      : status === 'trialing'
        ? 'bg-[#FEF3C7] text-[#92400E]'
        : status === 'past_due' || status === 'unpaid'
          ? 'bg-[#FEE2E2] text-[#991B1B]'
          : 'bg-line text-t4';
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function Line({ label, value, accent, strong }: { label: string; value: string; accent?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-semibold text-t2' : 'text-t4'}>{label}</dt>
      <dd className={`font-medium ${strong ? 'text-t1' : accent ? 'text-[#166534]' : 'text-t2'}`}>{value}</dd>
    </div>
  );
}
