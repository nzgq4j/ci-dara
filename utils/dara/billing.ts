import type Stripe from 'stripe';
import { stripe } from '@/utils/stripe/config';
import { withTenant, prismaAdmin } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';

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
  const company = await withTenant(companyId, (tx) =>
    tx.company.findUnique({ where: { id: companyId } })
  );
  if (!company) throw new Error('Company not found');
  if (company.stripeCustomerId) return company.stripeCustomerId;

  // Stripe call (network) outside any transaction.
  const customer = await stripe.customers.create({
    email,
    metadata: { companyId: companyId.toString() }
  });
  await withTenant(companyId, (tx) =>
    tx.company.update({
      where: { id: companyId },
      data: { stripeCustomerId: customer.id }
    })
  );
  return customer.id;
}

export interface BillingInvoice {
  id: string;
  date: Date;
  amount: number;
  currency: string;
  status: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export interface BillingOverview {
  status: Stripe.Subscription.Status;
  nextBillingDate: Date | null; // current period end — the next charge (or the end date if cancelling)
  renewalAmount: number | null; // dollars, per interval
  interval: string | null; // 'month' | 'year'
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  invoices: BillingInvoice[];
}

/**
 * Fetch the company's live subscription + recent invoices from Stripe for the billing page.
 * Read-only, best-effort — returns null (and logs) on any Stripe error so a hiccup never breaks
 * the page. No local schema needed: the source of truth for dates/amounts is Stripe itself.
 */
export async function getBillingOverview(
  stripeSubId: string | null,
  stripeCustomerId: string | null
): Promise<BillingOverview | null> {
  if (!stripeSubId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubId, {
      expand: ['default_payment_method']
    });
    const price = sub.items.data[0]?.price;

    // Payment method: prefer the subscription default, else the customer's invoice default.
    let card: Stripe.PaymentMethod.Card | null =
      sub.default_payment_method && typeof sub.default_payment_method !== 'string'
        ? sub.default_payment_method.card ?? null
        : null;
    if (!card && stripeCustomerId) {
      const customer = await stripe.customers.retrieve(stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method']
      });
      const pm =
        !('deleted' in customer) && customer.invoice_settings?.default_payment_method;
      if (pm && typeof pm !== 'string') card = pm.card ?? null;
    }

    let invoices: BillingInvoice[] = [];
    if (stripeCustomerId) {
      const list = await stripe.invoices.list({ customer: stripeCustomerId, limit: 6 });
      invoices = list.data.map((inv) => ({
        id: inv.id,
        date: new Date(inv.created * 1000),
        amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
        currency: inv.currency,
        status: inv.status ?? 'unknown',
        hostedUrl: inv.hosted_invoice_url ?? null,
        pdfUrl: inv.invoice_pdf ?? null
      }));
    }

    return {
      status: sub.status,
      nextBillingDate: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      renewalAmount: price?.unit_amount != null ? price.unit_amount / 100 : null,
      interval: price?.recurring?.interval ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      paymentMethod: card
        ? { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year }
        : null,
      invoices
    };
  } catch (e) {
    console.error('[billing] getBillingOverview failed:', e);
    return null;
  }
}

function mapStatus(s: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' | 'trialing' {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trialing';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  return 'canceled'; // canceled / incomplete / incomplete_expired / paused
}

/**
 * Apply a Stripe subscription's state to the owning Company.
 *
 * Cross-tenant by nature: the webhook resolves the company by stripeCustomerId
 * with no companyId in hand, so it runs on prismaAdmin (one of the three audited
 * cross-tenant paths). Only invoked from app/api/webhooks/route.ts. (DARA-004)
 */
export async function syncSubscriptionToCompany(subscription: Stripe.Subscription): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  let company = await prismaAdmin.company.findFirst({
    where: { stripeCustomerId: customerId }
  });
  if (!company && subscription.metadata?.companyId) {
    company = await prismaAdmin.company.findUnique({
      where: { id: BigInt(subscription.metadata.companyId) }
    });
  }
  if (!company) return;

  const priceId = subscription.items.data[0]?.price.id ?? '';
  const plan = priceIdToPlan(priceId);
  const status = mapStatus(subscription.status);
  const isActive = subscription.status === 'active' || subscription.status === 'trialing';

  await prismaAdmin.company.update({
    where: { id: company.id },
    data: {
      stripeCustomerId: customerId,
      stripeSubId: subscription.id,
      plan: isActive && plan ? plan : 'trial',
      planStatus: status
    }
  });

  await recordAudit({
    action: 'subscription.sync',
    companyId: company.id,
    actorEmail: 'stripe-webhook',
    entityType: 'company',
    entityId: company.id,
    metadata: { plan: isActive && plan ? plan : 'trial', planStatus: status }
  });
}
