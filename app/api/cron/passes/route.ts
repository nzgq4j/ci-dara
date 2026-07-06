import { NextRequest, NextResponse } from 'next/server';
import { processReviewJobs } from '@/utils/dara/passes';

// Async worker for multi-pass AI reviews. Vercel Cron hits this every minute (see
// vercel.json) to drain queued review-pass jobs; it's also the backstop/continuation for
// runs kicked immediately via after() in the Run action. Needs Fluid Compute for the long
// budget.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  // SEC-14 (NIST AC-3): CRON_SECRET is MANDATORY in production — fail closed if it ever
  // drifts out of the env rather than silently accepting unauthenticated calls to this
  // long-budget, CUI-processing worker. Outside production it stays optional so local/
  // preview cron and the in-request trigger work without the bearer. triggerWorker()
  // forwards the same bearer when the secret is set, so legit continuations still pass.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ ok: false, error: 'server misconfigured' }, { status: 500 });
    }
  } else {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }
  const res = await processReviewJobs(Date.now() + 260_000);
  return NextResponse.json({ ok: true, ...res });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
