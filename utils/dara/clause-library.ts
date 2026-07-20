// Clause library access + sync (Pass 3 source of truth).
//
// The library is GLOBAL reference data (public GSA DITA clause text). Reads go through prismaAdmin
// (the table has no company_id; dara_app has SELECT but prismaAdmin is simplest for a shared table).
// Writes (the sync upsert) are admin-only. Version resolution is deterministic: greatest effective_date
// at or before the solicitation's as-of date.

import { prismaAdmin } from '@/utils/prisma';

export interface ResolvedClause {
  plainText: string;
  effectiveDate: string; // ISO date
  facNumber: string | null;
  versionResolved: true;
}

// Normalize a citation to the library's `identifier` shape ("<TYPE> <number>"), collapsing whitespace.
export function normalizeCitation(citationType: string, citationText: string): { type: string; identifier: string } {
  const type = citationType.trim().toUpperCase();
  const cleaned = citationText.replace(/\s+/g, ' ').trim();
  // If the text already starts with the type, keep it; otherwise prefix it.
  const identifier = new RegExp(`^${type}\\b`, 'i').test(cleaned) ? cleaned.replace(/^(\w+)/, type) : `${type} ${cleaned}`;
  return { type, identifier: identifier.replace(/\s+/g, ' ').trim() };
}

/** Greatest effective_date <= asOf for this clause, or null if the clause/version isn't in the library. */
export async function resolveClauseVersion(
  citationType: string,
  citationText: string,
  asOf: Date
): Promise<ResolvedClause | null> {
  const { type, identifier } = normalizeCitation(citationType, citationText);
  const clause = await prismaAdmin.daraClauseLibrary.findUnique({
    where: { citationType_identifier: { citationType: type, identifier } },
    select: { id: true }
  });
  if (!clause) return null;
  const version = await prismaAdmin.daraClauseVersion.findFirst({
    where: { clauseId: clause.id, effectiveDate: { lte: asOf } },
    orderBy: { effectiveDate: 'desc' },
    select: { plainText: true, effectiveDate: true, facNumber: true }
  });
  if (!version) return null;
  return {
    plainText: version.plainText,
    effectiveDate: version.effectiveDate.toISOString().slice(0, 10),
    facNumber: version.facNumber,
    versionResolved: true
  };
}

// ── Sync (admin) ────────────────────────────────────────────────────────────

export interface SyncClauseVersion {
  effective_date: string;
  fac_number: string | null;
  content_hash: string;
  plain_text: string;
}
export interface SyncClause {
  citation_type: string;
  identifier: string;
  title?: string | null;
  github_repo: string;
  github_path: string;
  versions: SyncClauseVersion[];
}

/** Call the Modal `sync_clause_library` endpoint (clones the GSA repos, parses DITA). Never throws. */
export async function fetchClauseSync(): Promise<{ clauses: SyncClause[]; total: number } | { error: string }> {
  const url = process.env.MODAL_CLAUSE_SYNC_URL;
  const secret = process.env.MODAL_PARSER_SECRET;
  if (!url) return { error: 'MODAL_CLAUSE_SYNC_URL is not configured.' };
  if (!secret) return { error: 'MODAL_PARSER_SECRET is not configured.' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({})
    });
    if (!res.ok) return { error: `Modal sync HTTP ${res.status}` };
    const data: any = await res.json();
    return { clauses: Array.isArray(data?.clauses) ? data.clauses : [], total: Number(data?.total ?? 0) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Modal sync request failed.' };
  }
}

function parseEffectiveDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Upsert synced clauses into the library + versions (admin role). Returns counts. */
export async function upsertClauses(clauses: SyncClause[]): Promise<{ clauses: number; versions: number }> {
  let clauseCount = 0;
  let versionCount = 0;
  for (const c of clauses) {
    const type = c.citation_type.trim().toUpperCase();
    const identifier = (c.identifier || '').replace(/\s+/g, ' ').trim();
    if (!identifier) continue;
    const lib = await prismaAdmin.daraClauseLibrary.upsert({
      where: { citationType_identifier: { citationType: type, identifier } },
      create: {
        citationType: type,
        identifier,
        title: c.title ?? null,
        githubRepo: c.github_repo,
        githubPath: c.github_path
      },
      update: { githubRepo: c.github_repo, githubPath: c.github_path, title: c.title ?? undefined },
      select: { id: true }
    });
    clauseCount++;
    for (const v of c.versions ?? []) {
      const eff = parseEffectiveDate(v.effective_date);
      if (!eff || !v.plain_text) continue;
      await prismaAdmin.daraClauseVersion.upsert({
        where: { clauseId_effectiveDate: { clauseId: lib.id, effectiveDate: eff } },
        create: {
          clauseId: lib.id,
          effectiveDate: eff,
          facNumber: v.fac_number ?? null,
          contentHash: v.content_hash,
          plainText: v.plain_text
        },
        update: { contentHash: v.content_hash, plainText: v.plain_text, facNumber: v.fac_number ?? undefined },
        select: { id: true }
      });
      versionCount++;
    }
  }
  return { clauses: clauseCount, versions: versionCount };
}
