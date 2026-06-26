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

const primaryBtn =
  'inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#378ADD] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';

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
  const plans = Object.entries(PLAN_CATALOG) as [PaidPlan, (typeof PLAN_CATALOG)[PaidPlan]][];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Billing</h1>
          <p className="text-sm text-[#7d97b3]">
            Current plan: <span className="text-white">{company.plan}</span> ({company.planStatus})
          </p>
        </div>
        {company.stripeCustomerId && (
          <form action={manageBilling}>
            <button type="submit" className={ghostBtn}>
              <CreditCard className="h-4 w-4" />
              Manage billing
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>

      {searchParams?.success && (
        <div className="rounded-md border border-[#1f5a31]/50 bg-[#1f5a31]/10 px-4 py-3 text-sm text-[#7de0a0]">
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
              className={`flex flex-col rounded-lg border bg-[#0d1527] p-5 ${
                isCurrent ? 'border-[#378ADD]' : 'border-[#1a2f4a]'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{info.name}</h3>
                {isCurrent && (
                  <span className="rounded-full bg-[#378ADD]/20 px-2 py-0.5 text-xs font-medium text-[#7db8e0]">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold text-white">
                ${info.amount}
                <span className="text-sm font-normal text-[#7d97b3]">/mo</span>
              </div>
              <p className="mt-1 text-sm text-[#7d97b3]">{info.blurb}</p>
              <div className="mt-4 flex-1" />
              {isCurrent ? (
                <button type="button" disabled className="w-full cursor-default rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3]">
                  Active plan
                </button>
              ) : (
                <form action={createCheckout}>
                  <input type="hidden" name="plan" value={plan} />
                  <button type="submit" className={primaryBtn}>
                    <Check className="h-4 w-4" />
                    Choose {info.name}
                  </button>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-[#7d97b3]">
        Have a coupon? You can enter a promotion code on the Stripe checkout page.
        Subscriptions are billed monthly; manage or cancel anytime via “Manage
        billing”.
      </p>
    </div>
  );
}
