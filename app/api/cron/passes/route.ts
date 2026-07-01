import { NextRequest, NextResponse } from 'next/server';
import { processReviewJobs } from '@/utils/dara/passes';

// Async worker for multi-pass AI reviews. Vercel Cron hits this every minute (see
// vercel.json) to drain queued review-pass jobs; it's also the backstop/continuation for
// runs kicked immediately via after() in the Run action. Needs Fluid Compute for the long
// budget.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  // If CRON_SECRET is configured, require Vercel Cron's bearer token. When unset, allow
  // (the run still works via the in-request after() trigger; cron is just the backstop).
  const secret = process.env.CRON_SECRET;
  if (secret) {
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
