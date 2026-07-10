// Standalone HRLR runner — proves the pipeline on real documents this turn without touching the DB,
// schema, or prod. Reads a text file, runs the whole-document HRLR extraction, resolves the graph,
// and writes JSON + a Markdown report.
//
// PORT NOTE: in the app (utils/dara/requirements.ts) replace `callAnthropic` with the existing
//   complete(provider, system, user, model, apiKey, maxTokens)
// from utils/dara/providers.ts, and persist `graph.nodes` via Prisma. Everything else is unchanged.
//
// Usage:
//   npx tsx utils/dara/hrlr/run.ts --in <file.txt> --kind solicitation|response [--model <id>] [--out <dir>]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { buildHrlrPrompt, type DocKind } from './prompt';
import { parseHrlrNodes } from './parse';
import { resolveGraph } from './resolve';
import { renderReport } from './matrix';

loadEnv({ path: '.env.local' });

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function callAnthropic(system: string, user: string, model: string, maxTokens: number): Promise<{ text: string; tokenIn: number; tokenOut: number }> {
  const apiKey = process.env.PLATFORM_ANTHROPIC_KEY ?? '';
  if (!apiKey) throw new Error('PLATFORM_ANTHROPIC_KEY missing in .env.local');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Anthropic HTTP ${res.status}`);
  return {
    text: data?.content?.[0]?.text ?? '',
    tokenIn: Number(data?.usage?.input_tokens ?? 0),
    tokenOut: Number(data?.usage?.output_tokens ?? 0)
  };
}

async function main() {
  const inPath = arg('in');
  const kind = (arg('kind', 'solicitation') as DocKind);
  const model = arg('model', 'claude-sonnet-4-6');
  const outDir = arg('out', join(process.env.TEMP ?? '.', 'hrlr-out'));
  if (!inPath) throw new Error('Missing --in <file>');

  const docText = readFileSync(inPath, 'utf8');
  const docName = basename(inPath);
  console.log(`[hrlr] ${kind} · ${docName} · ${docText.length} chars · model ${model}`);

  const { system, user } = buildHrlrPrompt(docText, kind);
  const t0 = Date.now();
  const ai = await callAnthropic(system, user, model, 32000);
  console.log(`[hrlr] model returned in ${((Date.now() - t0) / 1000).toFixed(1)}s · in ${ai.tokenIn} / out ${ai.tokenOut} tokens`);

  const nodes = parseHrlrNodes(ai.text, docText, docName, kind);
  const graph = resolveGraph(nodes, kind, docName);
  console.log(
    `[hrlr] graph: ${graph.stats.total} nodes · ${graph.stats.standalone} standalone · ${graph.stats.parents} parents · ` +
      `${graph.stats.unresolved} unresolved · ${graph.stats.unverified} unverified · ${graph.numberingConflicts.length} numbering conflicts`
  );

  mkdirSync(outDir, { recursive: true });
  const stem = docName.replace(/\.[^.]+$/, '');
  const jsonPath = join(outDir, `${stem}.hrlr.json`);
  const mdPath = join(outDir, `${stem}.hrlr.md`);
  const rawPath = join(outDir, `${stem}.raw.txt`);
  writeFileSync(jsonPath, JSON.stringify(graph, null, 2));
  writeFileSync(mdPath, renderReport(graph));
  writeFileSync(rawPath, ai.text);
  console.log(`[hrlr] wrote:\n  ${jsonPath}\n  ${mdPath}\n  ${rawPath}`);
}

main().catch((e) => {
  console.error('[hrlr] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
