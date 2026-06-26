import type Stripe from 'stripe';
import { stripe } from '@/utils/stripe/config';
import { syncSubscriptionToCompany } from '@/utils/dara/billing';

const relevantEvents = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;

  try {
    if (!sig || !webhookSecret) {
      return new Response('Webhook secret not configured.', { status: 400 });
    }
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (!relevantEvents.has(event.type)) {
    return new Response(JSON.stringify({ received: true, ignored: event.type }));
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscriptionToCompany(event.data.object as Stripe.Subscription);
        break;
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subId);
          await syncSubscriptionToCompany(subscription);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[stripe webhook] handler error:', err);
    return new Response('Webhook handler failed.', { status: 400 });
  }

  return new Response(JSON.stringify({ received: true }));
}
