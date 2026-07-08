import { NextRequest, NextResponse } from 'next/server';
import { refreshPricing } from '@/utils/dara/pricing';

// Weekly refresh of per-model token pricing from the community feed (see vercel.json crons).
// Populates dara_ai_model_price 'feed' rows used to estimate AI run cost from the usage ledger;
// operator 'override' rows are left untouched.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  // Same CRON_SECRET gate as the review worker: mandatory in production, optional locally.
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
  const res = await refreshPricing();
  return NextResponse.json({ ok: !res.error, ...res }, { status: res.error ? 502 : 200 });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
