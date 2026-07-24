// Live transparency run-log for the v2 shred. The pipeline calls these as it executes; each writes a
// short row update so the UI (polling the latest run for a solicitation) streams the process in real
// time. Steps are append-only: beginStep pushes a {status:'running'} entry, endStep resolves it to
// done|failed with a duration/count. finishRun stamps the terminal state. All writes are tenant-scoped.

import { withTenant } from '@/utils/prisma';

export interface ShredStep {
  step: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
  count?: number;
  ms?: number;
  at: string;
}

async function readSteps(companyId: bigint, runId: bigint): Promise<ShredStep[]> {
  const row = await withTenant(companyId, (tx) =>
    tx.shredRun.findFirst({ where: { id: runId, companyId }, select: { steps: true } })
  );
  return Array.isArray(row?.steps) ? (row!.steps as unknown as ShredStep[]) : [];
}

/** Open a new run row (status=running) and return its id. */
export async function startRun(companyId: bigint, solicitationId: bigint): Promise<bigint> {
  const run = await withTenant(companyId, (tx) =>
    tx.shredRun.create({
      data: { companyId, solicitationId, status: 'running', currentStep: 'Starting…', steps: [], counts: {} },
      select: { id: true }
    })
  );
  return run.id;
}

/** Push a new step in the 'running' state and set it as the current step. */
export async function beginStep(companyId: bigint, runId: bigint, step: string, detail?: string): Promise<void> {
  const steps = await readSteps(companyId, runId);
  steps.push({ step, status: 'running', detail, at: new Date().toISOString() });
  await withTenant(companyId, (tx) =>
    tx.shredRun.updateMany({
      where: { id: runId, companyId },
      data: { steps: steps as unknown as object, currentStep: step, updatedAt: new Date() }
    })
  );
}

/** Resolve the most recent step of this name to done|failed with an optional duration and count. */
export async function endStep(
  companyId: bigint,
  runId: bigint,
  step: string,
  status: 'done' | 'failed',
  opts: { detail?: string; count?: number; ms?: number } = {}
): Promise<void> {
  const steps = await readSteps(companyId, runId);
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].step === step && steps[i].status === 'running') {
      steps[i] = { ...steps[i], status, detail: opts.detail ?? steps[i].detail, count: opts.count, ms: opts.ms };
      break;
    }
  }
  await withTenant(companyId, (tx) =>
    tx.shredRun.updateMany({ where: { id: runId, companyId }, data: { steps: steps as unknown as object, updatedAt: new Date() } })
  );
}

/** Stamp the terminal state (complete|failed) with the final counts. */
export async function finishRun(
  companyId: bigint,
  runId: bigint,
  status: 'complete' | 'failed',
  counts: Record<string, number>,
  error?: string
): Promise<void> {
  await withTenant(companyId, (tx) =>
    tx.shredRun.updateMany({
      where: { id: runId, companyId },
      data: {
        status,
        currentStep: status === 'complete' ? 'Complete' : 'Failed',
        counts: counts as unknown as object,
        error: error ? error.slice(0, 600) : null,
        finishedAt: new Date(),
        updatedAt: new Date()
      }
    })
  );
}

/** Latest run for a solicitation (for the live/saved UI panel). */
export async function latestRun(companyId: bigint, solicitationId: bigint) {
  return withTenant(companyId, (tx) =>
    tx.shredRun.findFirst({ where: { solicitationId, companyId }, orderBy: { id: 'desc' } })
  );
}
