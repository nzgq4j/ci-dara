import { AsyncLocalStorage } from 'node:async_hooks';

// Run context — carries a "run id" through the async call tree of a single AI run so every
// logUsage() write deep inside the engines (evaluator, passes, requirements, direct-review,
// amendments) can be attributed to the run that triggered it, WITHOUT threading a runId
// parameter through six function signatures and all their internals.
//
// The worker dispatch (utils/dara/passes.ts) wraps each job in withRunContext(`job:<id>`); any
// complete()/logUsage() that runs during that job inherits the id via AsyncLocalStorage. Calls
// outside any run context (a one-off inline action) simply get runId = null.

interface RunStore {
  runId: string;
}

const storage = new AsyncLocalStorage<RunStore>();

/** Run `fn` with `runId` in scope; every logUsage() inside it is tagged with that run. */
export function withRunContext<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ runId: runId.slice(0, 120) }, fn);
}

/** The run id currently in scope, or null if not inside a withRunContext(). */
export function currentRunId(): string | null {
  return storage.getStore()?.runId ?? null;
}
