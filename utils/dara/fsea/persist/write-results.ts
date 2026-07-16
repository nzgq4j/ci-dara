// FSEA Persist Layer — writes the output of all 10 passes to the database.
//
// Pass 10 Section A rows → dara_requirements (one row per matrix requirement)
// Pass 4 ontology       → dara_eval_factors + dara_eval_criteria (new tables, migration required)
// Pass 8 strengths      → dara_strength_opportunities (new table, migration required)
// Pass 10 Sections B/C/D + full pipeline JSON → stored in dara_solicitations.fsea_output JSONB
//
// The full pipeline JSON is stored so it can be displayed in the UI without re-running.
// Until the new tables exist, factors and strengths are stored in the JSONB blob.

import { withTenant } from '@/utils/prisma';
import type {
  P2Output, P3Output, P4Output, P5Output,
  P6Output, P7Output, P8Output, P9Output, P10Output,
  P10MatrixRow
} from '../types';

interface WriteFseaArgs {
  solicitationId: bigint;
  companyId: bigint;
  p2: P2Output;
  p3: P3Output;
  p4: P4Output;
  p5: P5Output;
  p6: P6Output;
  p7: P7Output;
  p8: P8Output;
  p9: P9Output;
  p10: P10Output;
}

// Map P10 priority to RequirementSource for the existing dara_requirements.source column
function sourceFromRow(row: P10MatrixRow, p5Req: { governingCriteriaIds?: string[] } | undefined): 'instruction' | 'evaluation_factor' | 'sow_pws' | 'far_clause' | 'other' {
  const criteria = p5Req?.governingCriteriaIds ?? [];
  // If the row connects to evaluation criteria starting with F (factor criteria) → instruction
  // PWS/SOW performance requirements → sow_pws
  // Compliance items not in the matrix → other
  if (criteria.some(c => c.startsWith('F'))) return 'instruction';
  return 'instruction'; // all matrix rows are proposal instructions by definition
}

function dispositionFromRow(row: P10MatrixRow): 'scored' | 'compliance' | 'administrative' {
  if (row.priority === 'lead' || row.priority === 'high') return 'compliance';
  if (row.priority === 'checklist_only') return 'administrative';
  return 'compliance';
}

export async function writeFseaResults(args: WriteFseaArgs): Promise<void> {
  const { solicitationId, companyId, p5, p10 } = args;

  // Build a lookup from reqId to P5 classified requirement
  const p5ByReqId = new Map(p5.classified.map(r => [r.reqId, r]));

  // Build a lookup from paragraphId to writing sequence for sort ordering
  const seqByParagraph = new Map<string, Map<number, string>>();
  for (const ws of p10.paragraphWritingSequences ?? []) {
    const m = new Map<number, string>();
    (ws.sequence ?? []).forEach((step, i) => m.set(i + 1, step));
    seqByParagraph.set(ws.paragraphId, m);
  }

  await withTenant(companyId, async (tx) => {

    // Write Section A matrix rows as requirements
    const rows = p10.sectionA ?? [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const p5Req = p5ByReqId.get(row.reqId);

      await tx.requirement.create({
        data: {
          companyId,
          solicitationId,
          // name = concise label (requirement summary, capped at 300 chars)
          name: row.requirement.slice(0, 300),
          // description = the proposal response obligation — the writing directive
          description: row.proposalResponseObligation,
          source: sourceFromRow(row, p5Req),
          disposition: dispositionFromRow(row),
          citation: row.reqId,
          complianceStatus: 'not_assessed',
          sortOrder: i,
          // FSEA-specific fields stored in hrlr JSONB until migration adds dedicated columns
          hrlr: {
            // Core FSEA output fields
            fseaPassRow: true,
            paragraphId: row.paragraphId,
            evaluationCriterion: row.evaluationCriterion,
            strengthGate: row.strengthGate ?? null,
            crossReference: row.crossReference ?? null,
            pageSignal: row.pageSignal,
            priority: row.priority,
            writingSequenceOrder: row.writingSequenceOrder ?? i,
            pageBudgetMin: row.pageBudgetMin ?? null,
            pageBudgetMax: row.pageBudgetMax ?? null,
            // From P5 classification
            type: p5Req?.type ?? null,
            actionable: p5Req?.actionable ?? null,
            governingCriteriaIds: p5Req?.governingCriteriaIds ?? [],
          }
        }
      });
    }

    // Write checklist items (Section D) as administrative requirements
    for (const ac of p10.sectionD ?? []) {
      await tx.requirement.create({
        data: {
          companyId,
          solicitationId,
          name: ac.requirement.slice(0, 300),
          description: `Source: ${ac.source} | Responsible: ${ac.responsible}`,
          source: 'other',
          disposition: 'administrative',
          citation: ac.acId,
          complianceStatus: 'not_assessed',
          sortOrder: rows.length + (p10.sectionD?.indexOf(ac) ?? 0),
          hrlr: {
            fseaPassRow: true,
            isChecklist: true,
            acId: ac.acId,
            responsible: ac.responsible,
            source: ac.source,
          }
        }
      });
    }

    // Store full pipeline output in solicitation notes JSONB for UI display
    // (until dedicated columns/tables are added via migration)
    await tx.solicitation.update({
      where: { id: solicitationId },
      data: {
        notes: JSON.stringify({
          fseaOutput: {
            sectionB: p10.sectionB,
            sectionC: p10.sectionC,
            executiveSummary: p10.executiveSummary,
            paragraphWritingSequences: p10.paragraphWritingSequences,
            evalOntology: {
              factors: (args.p4 as P4Output).factors,
              criteria: (args.p4 as P4Output).criteria,
              evaluationSurface: (args.p4 as P4Output).evaluationSurface,
              constructs: (args.p4 as P4Output).constructs,
            },
            crossRefs: (args.p9 as P9Output).internalCrossRefs,
            regulatoryCitations: (args.p9 as P9Output).regulatoryCitations,
            pageBudget: (args.p6 as P6Output).pageBudget,
          }
        })
      }
    });
  });
}
