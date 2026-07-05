// Annotated response export — streams a .docx of the proposal/response draft with the review's
// findings as real inline Word comments (see utils/dara/annotated-proposal). Node runtime + the
// full function budget because it makes one AI call (anchoring) before building the document.
// Optional ?reviewId scopes it to a specific color-team review; without it we use the Direct AI
// review (direct_ai sols) or the latest color-team review.

import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { generateAnnotatedProposal } from '@/utils/dara/annotated-proposal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) return new Response('Unauthorized', { status: 401 });

  if (!/^\d+$/.test(params.id)) return new Response('Not found', { status: 404 });
  const rid = new URL(req.url).searchParams.get('reviewId');
  const reviewId = rid && /^\d+$/.test(rid) ? BigInt(rid) : null;

  const res = await generateAnnotatedProposal(BigInt(params.id), reviewId, daraUser);
  if (!res.ok || !res.buffer) {
    return new Response(res.error ?? 'Export failed.', { status: res.status ?? 400 });
  }
  return new Response(new Uint8Array(res.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${res.filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
