import type Stripe from 'stripe';
import { stripe } from '@/utils/stripe/config';
import { prisma } from '@/utils/prisma';

// Plan catalog — maps the Company.plan enum to live Stripe prices.
export const PLAN_CATALOG = {
  starter: {
    priceId: 'price_1Tm7jqQNAQqSMxcEDsy5E9kc',
    name: 'DARA Base',
    amount: 150,
    blurb: 'For small teams getting started.'
  },
  pro: {
    priceId: 'price_1Tm7kHQNAQqSMxcE9jyIYDH1',
    name: 'DARA Pro',
    amount: 399,
    blurb: 'For active evaluation teams.'
  },
  enterprise: {
    priceId: 'price_1Tm7krQNAQqSMxcEeuKjLuHR',
    name: 'DARA Enterprise',
    amount: 899,
    blurb: 'For organizations at scale.'
  }
} as const;

export type PaidPlan = keyof typeof PLAN_CATALOG;

export function isPaidPlan(plan: string): plan is PaidPlan {
  return plan in PLAN_CATALOG;
}

export function priceIdToPlan(priceId: string): PaidPlan | null {
  for (const [plan, info] of Object.entries(PLAN_CATALOG)) {
    if (info.priceId === priceId) return plan as PaidPlan;
  }
  return null;
}

/** Get the company's Stripe customer id, creating the customer if needed. */
export async function getOrCreateCustomer(companyId: bigint, email: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error('Company not found');
  if (company.stripeCustomerId) return company.stripeCustomerId;

  const customer = await stripe.customers.create({
    email,
    metadata: { companyId: companyId.toString() }
  });
  await prisma.company.update({
    where: { id: companyId },
    data: { stripeCustomerId: customer.id }
  });
  return customer.id;
}

function mapStatus(s: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' | 'trialing' {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trialing';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  return 'canceled'; // canceled / incomplete / incomplete_expired / paused
}

/** Apply a Stripe subscription's state to the owning Company. */
export async function syncSubscriptionToCompany(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  let company = await prisma.company.findFirst({
    where: { stripeCustomerId: customerId }
  });
  if (!company && subscription.metadata?.companyId) {
    company = await prisma.company.findUnique({
      where: { id: BigInt(subscription.metadata.companyId) }
    });
  }
  if (!company) return;

  const priceId = subscription.items.data[0]?.price.id ?? '';
  const plan = priceIdToPlan(priceId);
  const status = mapStatus(subscription.status);
  const isActive = subscription.status === 'active' || subscription.status === 'trialing';

  await prisma.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubId: subscription.id,
      plan: isActive && plan ? plan : 'trial',
      planStatus: status
    }
  });
}
