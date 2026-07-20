-- ===================================================================================
-- Shred acceptance test battery (scope §11) — run AFTER a shred completes on :sol
-- Target test solicitation: 48 "AMCOM Again" (company 1, 195 parser candidates)
-- Reads the persisted run trace (dara_solicitations.notes -> shredTrace) + the rows.
-- ===================================================================================

-- 0) The run trace: what ran, timing, cost, counts (transparency, §R4)
select
  (notes::jsonb -> 'shredTrace' ->> 'generatedAt')                as generated_at,
  ((notes::jsonb -> 'shredTrace' ->> 'totalMs')::int)             as total_ms,
  ((notes::jsonb -> 'shredTrace' -> 'counts'))                    as counts,
  jsonb_array_length(notes::jsonb -> 'shredTrace' -> 'steps')     as step_count
from dara_solicitations where id = 48;

-- 1) Row inventory by source + disposition (negative test / discrimination, §R8)
select source, disposition, count(*) as n,
       count(*) filter (where review_status = 'flagged') as flagged
from dara_requirements where solicitation_id = 48
group by source, disposition order by source, disposition;

-- 2) Factors present (Section M extraction) (§R9)
select count(*) as factor_rows
from dara_requirements
where solicitation_id = 48 and source = 'evaluation_factor';

-- 3) Zero duplicates — no two rows share the same (document_id, span) (§R2 consistency)
select count(*) as duplicate_groups from (
  select document_id, span_start, span_end, count(*) c
  from dara_requirements
  where solicitation_id = 48 and span_start is not null
  group by document_id, span_start, span_end
  having count(*) > 1
) d;

-- 4) No parser-handle leakage in citations or names (§R8 anti-spurious)
select count(*) as handle_leaks
from dara_requirements
where solicitation_id = 48
  and (citation ~* '^(cand|sent|para|trigger)-' or citation ~* '^t[0-9]'
    or name     ~* '^(cand|sent|para|trigger)-' or name     ~* '^t[0-9]');

-- 5) L->M linkage rate (§ acceptance: >=70% of instruction/sow rows linked to a factor)
select
  count(*) filter (where source in ('instruction','sow_pws')) as linkable,
  count(*) filter (where source in ('instruction','sow_pws')
                   and array_length(governing_factors,1) > 0)  as linked,
  round(100.0 * count(*) filter (where source in ('instruction','sow_pws')
                   and array_length(governing_factors,1) > 0)
        / nullif(count(*) filter (where source in ('instruction','sow_pws')),0), 1) as linked_pct
from dara_requirements where solicitation_id = 48;

-- 6) Flagged (grounding/low-confidence) share — should be a minority (§R7 data QC)
select count(*) as total,
       count(*) filter (where review_status='flagged') as flagged,
       round(100.0*count(*) filter (where review_status='flagged')/nullif(count(*),0),1) as flagged_pct
from dara_requirements where solicitation_id = 48;

-- 7) No clause-text dumps / boilerplate inflation — max description length sane (§R8)
select max(length(description)) as max_desc_len,
       round(avg(length(description))) as avg_desc_len,
       count(*) filter (where length(description) > 4000) as over_4k
from dara_requirements where solicitation_id = 48;
