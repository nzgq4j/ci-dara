// Parse the HRLR model output into typed nodes and verify source provenance.
//
// Verbatim verification doctrine (from the span-anchored post-mortem): a requirement whose exact_text
// cannot be found in the source is FLAGGED, never silently dropped — a missing requirement is worse
// than a duplicate. We match on a whitespace/punctuation-normalized copy with a normalized->raw offset
// map so PDF artifacts (soft hyphens, doubled spaces, curly quotes/dashes) don't cause false misses,
// and we return RAW offsets.

import {
  CLAIM_TYPES,
  DISPOSITIONS,
  EVAL_SCOPES,
  MANDATORY_KINDS,
  NODE_STATES,
  REQUIREMENT_SOURCES,
  SATISFACTION_KINDS,
  type ClaimType,
  type Disposition,
  type EvalScope,
  type MandatoryKind,
  type NodeState,
  type RequirementNode,
  type RequirementSource,
  type SatisfactionKind
} from './types';

// ---------------------------------------------------------------------------------------------
// JSON extraction — tolerant of fences and a truncated trailing object.
export function stripFences(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1].trim();
  return t;
}

function parseNodesJson(text: string): any[] {
  const cleaned = stripFences(text);
  try {
    const data = JSON.parse(cleaned);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.nodes)) return data.nodes;
  } catch {
    /* salvage below */
  }
  // Salvage: grab the "nodes" array body and pull balanced top-level objects, tolerating truncation.
  const start = cleaned.indexOf('"nodes"');
  const from = start >= 0 ? cleaned.indexOf('[', start) : cleaned.indexOf('[');
  if (from < 0) return [];
  const objs: any[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;
  for (let i = from; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          objs.push(JSON.parse(cleaned.slice(objStart, i + 1)));
        } catch {
          /* skip malformed */
        }
        objStart = -1;
      }
    }
  }
  return objs;
}

// ---------------------------------------------------------------------------------------------
// Normalization for verbatim matching. Collapses whitespace runs, strips soft hyphens, and folds
// common typographic variants to ASCII — while building an index map back to raw offsets.
function buildNormalized(raw: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = []; // map[i] = raw index of out[i]
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '­') continue; // soft hyphen
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      ch = ' ';
      prevSpace = true;
    } else {
      prevSpace = false;
      // fold typographic variants
      if (ch === '‘' || ch === '’' || ch === '‛') ch = "'";
      else if (ch === '“' || ch === '”') ch = '"';
      else if (ch === '–' || ch === '—' || ch === '−') ch = '-';
      else if (ch === ' ') ch = ' ';
    }
    out.push(ch);
    map.push(i);
  }
  return { norm: out.join(''), map };
}

export interface SourceIndex {
  raw: string;
  norm: string;
  map: number[];
}

export function buildSourceIndex(raw: string): SourceIndex {
  const { norm, map } = buildNormalized(raw);
  return { raw, norm, map };
}

/** Locate exact_text in the source. Returns RAW [start,end) or null. Tries raw first, then normalized. */
export function locateSpan(idx: SourceIndex, needle: string): { start: number; end: number } | null {
  if (!needle) return null;
  const rawAt = idx.raw.indexOf(needle);
  if (rawAt >= 0) return { start: rawAt, end: rawAt + needle.length };
  const nNeedle = buildNormalized(needle).norm.trim();
  if (!nNeedle) return null;
  const nAt = idx.norm.indexOf(nNeedle);
  if (nAt < 0) return null;
  const start = idx.map[nAt];
  const lastNormIdx = Math.min(nAt + nNeedle.length - 1, idx.map.length - 1);
  const end = idx.map[lastNormIdx] + 1;
  return { start, end };
}

// ---------------------------------------------------------------------------------------------
function pick<T extends string>(v: any, allowed: readonly T[], fallback: T): T {
  const s = String(v ?? '').trim();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function mapNode(raw: any, idx: SourceIndex, docName: string, docKind: 'solicitation' | 'response'): RequirementNode | null {
  const key = String(raw?.key ?? '').trim();
  const exactText = String(raw?.exact_text ?? '').trim();
  const meaning = String(raw?.normalized_meaning ?? '').trim();
  if (!key) return null;
  if (!exactText && !meaning) return null;

  const state = pick<NodeState>(raw?.state, NODE_STATES, 'UNRESOLVED');
  const mandatory = pick<MandatoryKind>(raw?.mandatory, MANDATORY_KINDS, 'MANDATORY');
  const source = pick<RequirementSource>(raw?.source, REQUIREMENT_SOURCES, 'other');
  let disposition = pick<Disposition>(raw?.disposition, DISPOSITIONS, source === 'evaluation_factor' ? 'scored' : 'compliance');
  if (disposition === 'scored' && source !== 'evaluation_factor') disposition = 'compliance';

  const satKind = pick<SatisfactionKind>(raw?.satisfaction?.kind, SATISFACTION_KINDS, 'NONE');
  const nRaw = Number(raw?.satisfaction?.n);
  const evalScope = pick<EvalScope>(raw?.eval_scope, EVAL_SCOPES, 'SELF');

  const childKeys = Array.isArray(raw?.children) ? raw.children.map((k: any) => String(k).trim()).filter(Boolean) : [];
  const parentKeyRaw = raw?.parent == null ? null : String(raw.parent).trim();
  const parentKey = parentKeyRaw && parentKeyRaw.toLowerCase() !== 'null' ? parentKeyRaw : null;

  const span = locateSpan(idx, exactText);

  let response = null as RequirementNode['response'];
  if (docKind === 'response') {
    response = {
      claimType: pick<ClaimType>(raw?.claim_type, CLAIM_TYPES, 'NARRATIVE'),
      addressesMarkers: Array.isArray(raw?.addresses_markers)
        ? raw.addresses_markers.map((m: any) => String(m).trim()).filter(Boolean)
        : []
    };
  }

  return {
    logicalId: '', // assigned in resolve
    syntheticPath: '', // assigned in resolve
    key,
    parentKey,
    childKeys,
    state,
    mandatory,
    exactText,
    normalizedMeaning: meaning,
    source,
    disposition,
    satisfaction: {
      kind: satKind,
      n: Number.isFinite(nRaw) && nRaw > 0 ? Math.round(nRaw) : null,
      basis: pick(raw?.satisfaction?.basis, ['EXPLICIT', 'INFERRED', 'UNRESOLVED'] as const, 'UNRESOLVED'),
      rationale: String(raw?.satisfaction?.rationale ?? '').trim()
    },
    evalScope,
    applicability: String(raw?.applicability ?? '').trim(),
    provenance: {
      documentName: docName,
      sectionPath: String(raw?.section_path ?? '').trim(),
      originalMarker: String(raw?.source_marker ?? '').trim(),
      page: Number.isFinite(Number(raw?.page)) ? Number(raw.page) : null,
      exactText,
      spanStart: span?.start ?? null,
      spanEnd: span?.end ?? null,
      verbatimVerified: span !== null
    },
    confidence: pick(raw?.confidence, ['HIGH', 'MEDIUM', 'LOW'] as const, 'MEDIUM'),
    confidenceRationale: String(raw?.confidence_rationale ?? '').trim(),
    response,
    flags: []
  };
}

/** Parse the model output into nodes with provenance verified against `sourceText`. */
export function parseHrlrNodes(
  modelText: string,
  sourceText: string,
  docName: string,
  docKind: 'solicitation' | 'response'
): RequirementNode[] {
  const idx = buildSourceIndex(sourceText);
  const rawNodes = parseNodesJson(modelText);
  return rawNodes.map((n) => mapNode(n, idx, docName, docKind)).filter((n): n is RequirementNode => n !== null);
}
