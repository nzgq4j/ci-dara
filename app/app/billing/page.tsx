import { redirect } from 'next/navigation';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';
import { stripe } from '@/utils/stripe/config';
import { getURL } from '@/utils/helpers';
import {
  PLAN_CATALOG,
  isPaidPlan,
  getOrCreateCustomer,
  type PaidPlan
} from '@/utils/dara/billing';
import PageHeader from '@/components/dara/PageHeader';
import { card, btnPrimary, btnGhost } from '@/components/dara/theme';

const PLAN_LABELS: Record<string, string> = {
  trial: 'Trial',
  starter: 'Base',
  pro: 'Pro',
  enterprise: 'Enterprise'
};

async function requireCompanyAdmin() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  if (daraUser.role !== 'company_admin') redirect('/app/dashboard');
  return daraUser;
}

async function createCheckout(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const plan = String(formData.get('plan') ?? '');
  if (!isPaidPlan(plan)) return;

  const customer = await getOrCreateCustomer(daraUser.companyId, daraUser.email);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: PLAN_CATALOG[plan].priceId, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    success_url: getURL('/app/billing?success=1'),
    cancel_url: getURL('/app/billing'),
    subscription_data: { metadata: { companyId: daraUser.companyId.toString() } },
    metadata: { companyId: daraUser.companyId.toString() }
  });
  if (session.url) redirect(session.url);
}

async function manageBilling() {
  'use server';
  const daraUser = await requireCompanyAdmin();
  const company = await prisma.company.findUnique({ where: { id: daraUser.companyId } });
  if (!company?.stripeCustomerId) return;
  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: getURL('/app/billing')
  });
  if (session.url) redirect(session.url);
}

export default async function BillingPage({
  searchParams
}: {
  searchParams: { success?: string };
}) {
  const daraUser = await requireCompanyAdmin();
  const company = await prisma.company.findUnique({ where: { id: daraUser.companyId } });
  if (!company) redirect('/app/dashboard');

  const currentPlan = company.plan;
  const currentLabel = PLAN_LABELS[currentPlan] ?? currentPlan;
  const plans = Object.entries(PLAN_CATALOG) as [PaidPlan, (typeof PLAN_CATALOG)[PaidPlan]][];

  return (
    <div className="mx-auto max-w-4xl fade">
      <PageHeader
        eyebrow="Account"
        title="Billing"
        subtitle={
          <>
            Current plan: <span className="text-[#e8eef7]">{currentLabel}</span> ({company.planStatus})
          </>
        }
        action={
          company.stripeCustomerId ? (
            <form action={manageBilling}>
              <button type="submit" className={btnGhost}>
                <CreditCard className="h-4 w-4" />
                Manage billing
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : undefined
        }
      />

      {searchParams?.success && (
        <div className="mb-6 rounded-lg border border-[#1f5a31]/50 bg-[#1f5a31]/10 px-4 py-3 text-[13px] text-[#7de0a0]">
          Subscription updated. If your plan doesn&apos;t reflect the change yet,
          it will once Stripe confirms the payment (via webhook).
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map(([plan, info]) => {
          const isCurrent = currentPlan === plan;
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-[10px] border bg-[#0d1527] p-5 ${
                isCurrent ? 'border-[#3b6ef0] ring-1 ring-[#3b6ef0]/40' : 'border-[#1a2f4a]'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[#f0f4ff]">{info.name}</h3>
                {isCurrent && (
                  <span className="rounded bg-[#3b6ef0]/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-[#6f9bf5]">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-3 text-3xl font-bold leading-none text-[#f0f4ff]">
                ${info.amount}
                <span className="text-[13px] font-normal text-[#7d97b3]">/mo</span>
              </div>
              <p className="mt-2 text-[13px] text-[#7d97b3]">{info.blurb}</p>
              <div className="mt-5 flex-1" />
              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="w-full cursor-default rounded-lg border border-[#1a2f4a] px-3 py-2 text-[13px] font-medium text-[#7d97b3]"
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

      <p className="mt-6 text-[12px] text-[#3d5270]">
        Have a coupon? You can enter a promotion code on the Stripe checkout page.
        Subscriptions are billed monthly; manage or cancel anytime via &ldquo;Manage
        billing&rdquo;.
      </p>
    </div>
  );
}
