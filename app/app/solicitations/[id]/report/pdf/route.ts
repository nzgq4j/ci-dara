// Real PDF export for the analysis report. Renders the shared ReportModel to a vector PDF with
// @react-pdf/renderer (Node runtime) and streams it as a download — replaces the old
// window.print() path so pagination/layout are controlled, not left to the browser.

import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { loadReportModel } from '@/utils/dara/report-data';
import { recordAudit } from '@/utils/dara/audit';
import ReportPdf from '@/components/dara/ReportPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) return new Response('Unauthorized', { status: 401 });

  if (!/^\d+$/.test(params.id)) return new Response('Not found', { status: 404 });
  const model = await loadReportModel(BigInt(params.id), daraUser);
  if (!model) return new Response('Not found', { status: 404 });

  // SEC-10 (NIST AU-2/AU-3): the analysis-report PDF carries CUI off-platform; audit the
  // export (action + entity only, no CUI content).
  await recordAudit({
    action: 'report.export',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'solicitation',
    entityId: params.id,
    metadata: { format: 'pdf' }
  });

  // ReportPdf returns a <Document>; renderToBuffer's types want a Document element specifically,
  // so cast the component element to its expected parameter type.
  const buffer = await renderToBuffer(
    createElement(ReportPdf, { model }) as unknown as Parameters<typeof renderToBuffer>[0]
  );
  const base = (model.solNumber || model.title || 'analysis-report').replace(/[^\w.-]+/g, '_').slice(0, 60);
  const filename = `${base || 'analysis-report'}_analysis_report.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    }
  });
}
