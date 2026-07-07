'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { stripe } from '@/utils/stripe/config';
import { getURL } from '@/utils/helpers';
import { PLAN_CATALOG, isPaidPlan, getOrCreateCustomer } from '@/utils/dara/billing';

export async function requireCompanyAdmin() {
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

export async function createCheckout(formData: FormData) {
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
    success_url: getURL('/app/settings?tab=billing&success=1'),
    cancel_url: getURL('/app/settings?tab=billing'),
    subscription_data: { metadata: { companyId: daraUser.companyId.toString() } },
    metadata: { companyId: daraUser.companyId.toString() }
  });
  if (session.url) redirect(session.url);
}

export async function manageBilling() {
  const daraUser = await requireCompanyAdmin();
  const company = await withTenant(daraUser.companyId, (tx) =>
    tx.company.findUnique({ where: { id: daraUser.companyId } })
  );
  if (!company?.stripeCustomerId) return;
  const session = await stripe.billingPortal.sessions.create({
    customer: company.stripeCustomerId,
    return_url: getURL('/app/settings?tab=billing')
  });
  if (session.url) redirect(session.url);
}
