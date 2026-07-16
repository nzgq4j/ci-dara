// FSEA Persist Layer
//
// writeFseaResults: full pipeline — writes all pass outputs after a complete run
// writeFseaPartial: partial save — called when the pipeline is interrupted or a
//   late pass fails; saves whatever was produced so the run is not a total loss

import { withTenant } from '@/utils/prisma';
import type {
  P2Output, P3Output, P4Output, P5Output,
  P6Output, P7Output, P8Output, P9Output, P10Output,
  P10MatrixRow
} from '../types';

// ── Source/disposition helpers ─────────────────────────────────────────────────

function sourceFromCriteria(governingCriteriaIds: string[]): 'instruction' | 'evaluation_factor' | 'other' {
  if (!governingCriteriaIds || governingCriteriaIds.length === 0) return 'instruction';
  // Evaluation-factor source rows are the Section M criteria themselves, not the instructions
  // that feed them. All matrix rows in FSEA are proposal instructions.
  return 'instruction';
}

function dispositionFromPriority(priority: string): 'scored' | 'compliance' | 'administrative' {
  if (priority === 'checklist_only') return 'administrative';
  if (priority === 'lead' || priority === 'high' || priority === 'medium' || priority === 'low') return 'compliance';
  return 'compliance';
}

// ── Full write ─────────────────────────────────────────────────────────────────

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

export async function writeFseaResults(args: WriteFseaArgs): Promise<void> {
  const { solicitationId, companyId, p5, p10 } = args;

  const p5ByReqId = new Map((p5.classified ?? []).map(r => [r.reqId, r]));
  const rows = p10.sectionA ?? [];
  const checklist = p10.sectionD ?? [];

  await withTenant(companyId, async (tx) => {

    // Section A — matrix requirements (one row per actionable requirement)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row?.reqId) continue;

      const p5Req = p5ByReqId.get(row.reqId);
      const criteriaIds = p5Req?.governingCriteriaIds ?? [];

      await tx.requirement.create({
        data: {
          companyId,
          solicitationId,
          name: (row.requirement ?? '').slice(0, 300) || row.reqId,
          description: row.proposalResponseObligation ?? null,
          source: sourceFromCriteria(criteriaIds),
          disposition: dispositionFromPriority(row.priority ?? 'medium'),
          citation: (row.reqId ?? '').slice(0, 200),
          complianceStatus: 'not_assessed',
          sortOrder: i,
          hrlr: {
            fseaPassRow: true,
            paragraphId: row.paragraphId ?? null,
            evaluationCriterion: row.evaluationCriterion ?? null,
            strengthGate: row.strengthGate ?? null,
            crossReference: row.crossReference ?? null,
            pageSignal: row.pageSignal ?? null,
            priority: row.priority ?? null,
            writingSequenceOrder: row.writingSequenceOrder ?? i,
            pageBudgetMin: row.pageBudgetMin ?? null,
            pageBudgetMax: row.pageBudgetMax ?? null,
            type: p5Req?.type ?? null,
            actionable: p5Req?.actionable ?? null,
            governingCriteriaIds: criteriaIds,
          }
        }
      });
    }

    // Section D — administrative compliance checklist
    for (let i = 0; i < checklist.length; i++) {
      const ac = checklist[i];
      if (!ac?.acId) continue;

      await tx.requirement.create({
        data: {
          companyId,
          solicitationId,
          name: (ac.requirement ?? '').slice(0, 300) || ac.acId,
          description: `Source: ${ac.source ?? ''} | Responsible: ${ac.responsible ?? ''}`,
          source: 'other',
          disposition: 'administrative',
          citation: (ac.acId ?? '').slice(0, 200),
          complianceStatus: 'not_assessed',
          sortOrder: rows.length + i,
          hrlr: {
            fseaPassRow: true,
            isChecklist: true,
            acId: ac.acId,
            responsible: ac.responsible ?? null,
            source: ac.source ?? null,
          }
        }
      });
    }

    // Store full FSEA output in solicitation notes for UI sub-tabs
    await tx.solicitation.update({
      where: { id: solicitationId },
      data: {
        notes: buildFseaNotesJson(args)
      }
    });
  });
}

// ── Partial write (pipeline interrupted or late pass failed) ───────────────────

interface WriteFseaPartialArgs {
  solicitationId: bigint;
  companyId: bigint;
  p2?: P2Output;
  p3?: P3Output;
  p4?: P4Output;
  p5?: P5Output;
  p6?: P6Output;
  p7?: P7Output;
  p8?: P8Output;
  p9?: P9Output;
  error: string;
}

export async function writeFseaPartial(args: WriteFseaPartialArgs): Promise<void> {
  const { solicitationId, companyId } = args;

  try {
    await withTenant(companyId, async (tx) => {
      // If we have P5 classified requirements, write them as minimal matrix rows
      if (args.p5) {
        const matrixReqs = (args.p5.classified ?? []).filter(r => r.disposition === 'MATRIX');
        for (let i = 0; i < matrixReqs.length; i++) {
          const req = matrixReqs[i];
          if (!req?.reqId) continue;

          // Find the original candidate for the full requirement text
          const candidate = (args.p2?.candidates ?? []).find(c => c.reqId === req.reqId);

          await tx.requirement.create({
            data: {
              companyId,
              solicitationId,
              name: (req.requirementSummary ?? req.reqId).slice(0, 300),
              description: candidate?.exactText ?? null,
              source: 'instruction',
              disposition: 'compliance',
              citation: (req.reqId ?? '').slice(0, 200),
              complianceStatus: 'not_assessed',
              sortOrder: i,
              hrlr: {
                fseaPassRow: true,
                partial: true,
                paragraphId: req.sectionId ?? null,
                governingCriteriaIds: req.governingCriteriaIds ?? [],
              }
            }
          }).catch(() => { /* skip duplicate */ });
        }
      }

      // Save whatever pipeline data we have
      await tx.solicitation.update({
        where: { id: solicitationId },
        data: {
          notes: JSON.stringify({
            fseaOutput: {
              partial: true,
              error: args.error,
              passesCompleted: {
                p2: !!args.p2,
                p3: !!args.p3,
                p4: !!args.p4,
                p5: !!args.p5,
                p6: !!args.p6,
                p7: !!args.p7,
                p8: !!args.p8,
                p9: !!args.p9,
              },
              sectionB: [],
              sectionC: [],
              sectionD: [],
              executiveSummary: null,
              evalOntology: args.p4 ? {
                factors: args.p4.factors ?? [],
                criteria: args.p4.criteria ?? [],
                evaluationSurface: args.p4.evaluationSurface ?? [],
                constructs: args.p4.constructs ?? [],
              } : null,
              pageBudget: args.p6?.pageBudget ?? [],
              crossRefs: args.p9?.internalCrossRefs ?? [],
              regulatoryCitations: args.p9?.regulatoryCitations ?? [],
              strengthOpportunities: args.p8?.strengthOpportunities ?? [],
              paragraphWritingSequences: [],
            }
          })
        }
      });
    });
  } catch (e) {
    // Partial save failure is non-fatal — log and continue
    console.error('[fsea] writeFseaPartial failed:', e instanceof Error ? e.message : e);
  }
}

// ── Notes JSON builder ─────────────────────────────────────────────────────────

function buildFseaNotesJson(args: WriteFseaArgs): string {
  const { p4, p6, p8, p9, p10 } = args;

  return JSON.stringify({
    fseaOutput: {
      partial: false,
      sectionB: p10.sectionB ?? [],
      sectionC: p10.sectionC ?? [],
      sectionD: p10.sectionD ?? [],
      executiveSummary: p10.executiveSummary ?? null,
      paragraphWritingSequences: p10.paragraphWritingSequences ?? [],
      evalOntology: {
        factors: p4.factors ?? [],
        criteria: p4.criteria ?? [],
        evaluationSurface: p4.evaluationSurface ?? [],
        constructs: p4.constructs ?? [],
      },
      crossRefs: p9.internalCrossRefs ?? [],
      regulatoryCitations: p9.regulatoryCitations ?? [],
      cdrlLinkages: p9.cdrlLinkages ?? [],
      solicitationAnchors: p9.solicitationAnchors ?? [],
      actionsRequired: p9.actionsRequired ?? [],
      pageBudget: p6.pageBudget ?? [],
      strengthTargetList: p6.strengthTargetList ?? [],
      strengthOpportunities: p8.strengthOpportunities ?? [],
      strengthSummary: p8.summary ?? null,
      criticalGapAdvisory: p8.criticalGapAdvisory ?? null,
    }
  });
}
