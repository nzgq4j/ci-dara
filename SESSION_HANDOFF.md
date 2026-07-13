# DARA — Session Handoff

_Prepared: 2026-07-11 · last DEPLOYED code `0709595` (`dpl_6AHhbXkRpyeYomcTj7kHBU7PSD6T`, `ci-dara-qzz5bb5ub`) · branch `main` · for: next session_

Start-here doc. **Everything below is committed, pushed, + live on production** (`dara.crucibleinsight.com`).
`main` == `0709595` == last deployed. Working tree clean except the untracked `SECURITY_BACKLOG.md` +
`tsconfig.tsbuildinfo`. Deep decision log: `BUILD_STATUS.md` (§-5 for this session). **Start with §0 below
(2026-07-11).**

> ✅ **Operator steps DONE** (user confirmed 2026-07-07): Supabase Manual Linking enabled + 12 branded email
> templates pasted.
> ⚠️ **`SECURITY_BACKLOG.md` is tracked in git** despite its "do not commit while open" header (file:line
> exploit detail for open findings). Decide whether to untrack it (`git rm --cached SECURITY_BACKLOG.md` +
> `.gitignore`; scrub history if the repo is public) or accept. **The security backlog remains the top
> priority** — this session was admin-console/observability work, not security (see §5).

---

## 0 (2026-07-13, LATEST). Increment-1 + L→M wiring — BUILT + verified, DEPLOY PENDING

The build inspected-and-deferred below was completed. **Code done + verified (`tsc`/`pnpm build` clean; 16/16
deterministic unit checks); NOT deployed** (one additive migration pending). `MODAL_PARSER_SECRET` is **rotated**
(done — do not re-flag) and the §0 (2026-07-13) Modal commit is **pushed** (`origin/main == 57c4e8d`). Full log:
`BUILD_STATUS.md` §-8. Memory: `increment1-lm-wiring.md`. Scope the user chose: fix Section M extraction AND
build the L→M link, computed in the shred.

- **Fix 1** `requirements.ts` `cleanSourceText()` (NFKC + strip soft-hyphen/zero-width/BOM, no single-letter
  regex) on source text before extraction+verification → fixes the 99/278 `verbatimVerified=false` class,
  app-side (not Modal; `parse.ts` is protected), retroactive on regenerate.
- **Fix 2** enum `RequirementReviewStatus` + `review_status` column (migration
  `20260713140000_requirement_review_status_governance`, additive) auto-set at shred; matrix flagged badge +
  "Needs review" filter + approve/reject/flag in the detail modal (`setReviewStatusAction`, BOLA-safe).
- **D5 FIXED** — `hrlr/prompt.ts` + `PARSER_HANDLE` reject `cand-`/`trigger-`/`t\d+` markers.
- **Section M** — `SOLICITATION_GUIDANCE` recognizes evaluation factors as `evaluation_factor`/`scored`.
- **L→M** — model emits `governing_factors`; `requirements.ts` reads it off raw JSON → `governing_factors text[]`
  column; "Evaluated under" in the modal + export. Unblocks backlog item 9 (Evaluation-Only view).

**Deploy when asked:** `pnpm prisma migrate deploy` → `vercel deploy --prod --yes` → `git push`. The live
dense-RFP shred (Section M classification + governance links) is the untested "true test".

---

## 0 (2026-07-13, earlier). Increment-1 + L→M wiring — INSPECTION ONLY, NOT STARTED (deferred by user)

A three-part prompt (Fix 1 Modal text cleaning · Fix 2 parse-QA `reviewStatus` · L→M wiring) was **inspected but
NOT implemented** — user chose to stop after Phase 1 and defer the build to a future session. **No feature code
written.** Phase 1 surfaced several places where the prompt's "Confirmed Facts" diverge from the actual repo/prod,
which the next session MUST account for. Full detail: `BUILD_STATUS.md` §-7. Verified data-model facts are now
also pinned in `CLAUDE.md`.

**Divergences found (prompt "Confirmed Facts" vs reality):**
- **D1 `source` values** — actual enum is `instruction` / `evaluation_factor` / `sow_pws` / `far_clause` /
  `other`. **Section L = `source='instruction'`, Section M = `source='evaluation_factor'`.** The prompt's
  `'Section L instruction'`/`'M factor'` are labels, not DB values (any query using them returns 0 rows).
- **D2 `reviewStatus` does NOT exist on the Requirement model** (only `complianceStatus`). The prompt's claim it
  "was added last session" is false. The existing `ReviewStatus` enum (`draft/in_progress/complete`) is the
  color-team **Review** table's workflow status — a DIFFERENT concept from Fix 2's **parse-QA** status (user
  confirmed). → **Fix 2 must ADD a new column + enum** (name it to avoid colliding with `ReviewStatus`, e.g. field
  `reviewStatus` + enum `RequirementReviewStatus` with pending/approved/rejected/flagged).
- **D3 `evalScope` cannot drive DIRECT L→M mapping** — it is a 5-value STRUCTURAL enum
  (`SELF/EACH_CHILD/PARENT_COLLECTIVE/AGGREGATE_SET/UNRESOLVED`), never a Section M cross-reference. The prompt's
  `buildDirectMappings` (scan evalScope for an M citation) yields **exactly 0** mappings. Prod confirms: all L
  rows are `SELF`(8)/`PARENT_COLLECTIVE`(2)/`EACH_CHILD`(1). **The DIRECT mechanism must be redefined** (e.g.
  explicit M citation/factor-name found in the L instruction TEXT / `applicability` / `sectionPath`).
- **D4 almost no Section M data exists** — prod-wide: **11 Section L rows, 1 Section M row**; only sol id 30 has
  both (4 L, 1 M). Matrix is 237 `sow_pws` + 25 `other` + 11 `instruction` + 4 `far_clause` + **1
  `evaluation_factor`**. L→M has ~nothing to wire until the shred actually extracts Section M factors (the real
  blocker).
- **D5 (discovered regression) `citation` polluted by Modal artifacts** — many L rows have
  `citation='cand-sent-para-p1-1'` (a Modal `candidate_id`). The structured preamble added last session formats
  candidates as `[cand-…] SOURCE:…` and the model is copying that bracket ID into `source_marker`→`citation`. Fix
  lives in `utils/dara/hrlr/prompt.ts` — which THIS prompt barred from editing (unresolved constraint conflict).

**What the data validates:**
- **Fix 1 (Modal text cleaning) is well-motivated:** 99/278 hrlr rows are `verbatimVerified=false`, **82 of them
  HIGH confidence** — the soft-hyphen/zero-width/NFKC false-positive class. ⚠️ Drop the prompt's stray
  single-uppercase-letter regex — it would eat legitimate tokens ("Section A", "Part B", "Exhibit C").
- **flags present on 153/278 (55%)** → under Fix 2's rules a majority would be `flagged`; intentional but high.

**Feasibility:** Fix 1 ✅ (drop single-letter rule). Fix 2 ✅ but needs the D2 schema add. L→M ⚠️ infra buildable
(table/RLS/UI/exports/gap-report) but must replace the dead evalScope-DIRECT premise, and its VALUE is blocked on
Section M extraction (D4) + citation pollution (D5).

**Open decisions for next session (were about to be asked when user deferred):**
1. **L→M approach** — (a) build infra + INFERRED-only now (DIRECT = explicit M citation/name in L text), data-thin;
   (b) defer L→M, ship Fix 1+2 only; (c) fix Section M extraction first (higher-leverage, needs hrlr/prompt.ts).
2. **Constraint conflicts** — the D5 citation fix needs `hrlr/prompt.ts` (barred this prompt); and confirm dropping
   the Fix-1 single-letter regex.

**Key build anchors (already located):** shred write `utils/dara/requirements.ts` (`createMany` rows object, ~L176);
Modal parse `modal/app.py` (`_parse_pdf` page_text→paragraphs+`_process_sentences`; `_parse_docx`; table
`reconstructed_text`; Python 3.12 / spaCy 3.8.14; NO `clean_extracted_text` yet); matrix export cols
`[id]/page.tsx` `exportMatrixAction` (~L522, 9 cols) → `matrix-docx.ts` (generic cols/rows, 9 `COL_WIDTHS`);
`AiActionButton` pattern `[id]/page.tsx` ~L1743; matrix render `components/dara/ComplianceMatrix.tsx` (CSS-grid:
Requirement · Source · Response Location · Status · Notes + detail modal).

---

## 0 (2026-07-13). Modal structural parser integration — ✅ DEPLOYED

**Deployed to prod this session.** Migration `20260713120000_parse_results` applied → RLS
`2026-07-13_parse_results_rls.sql` applied (owner) → `vercel deploy --prod` (`dpl_CSjJmb4PtMarptZYbnJHQnWsfkCw`,
READY, aliased `dara.crucibleinsight.com`). Live Modal endpoint smoke-tested 200 / `quality_gate_passed=true`.
Committed as `57c4e8d` (**not pushed** — `main` is 1 ahead of `origin/main`). ⚠️ **`MODAL_PARSER_SECRET` rotation
pending before go-live** (it was exposed in a smoke-test command). Full decision log: `BUILD_STATUS.md` §-6.

**What it is.** The deployed Modal `dara-parser` (pdfplumber + spaCy) is wired into the app. Document uploads
call Modal synchronously, store the structured `ParseResult` in the versioned `dara_parse_results` table, and
the HRLR shred reads that structured output (preamble: obligations, CDRL tables, IbR, conditionals) instead
of flat text — **the `hrlr` JSONB output format is unchanged**. Fully fallback-safe: no Modal / any error → flat
unpdf/mammoth path. Pre-feature documents (no parse row) are unaffected. Platform-admin-only parse-history
viewer + async re-parse job included.

**Follow-ups:** rotate `MODAL_PARSER_SECRET` (Modal `dara-parser-secret` AUTH_TOKEN + Vercel all-envs + `.env.local`,
must match), then `vercel deploy --prod --yes` so the app picks it up; `git push` to sync `origin/main`. NOTE: the
structured preamble is the source of the D5 citation pollution (see the inspection entry above).

---

## 0. Latest session (2026-07-11) — shred scan-integrity guards + requirement-detail modal

Commit `0709595` on `main`, **pushed + deployed to prod** (`dpl_6AHhbXkRpyeYomcTj7kHBU7PSD6T`,
`ci-dara-qzz5bb5ub`, READY / production, newest prod deployment, aliased `dara.crucibleinsight.com`). **No
migration** (TypeScript logic + UI only). `tsc --noEmit` + `pnpm build` clean. Full decision log:
`BUILD_STATUS.md` §-5.

**What it is.** Two deterministic guards that catch model-side HRLR extraction defects the pipeline previously
couldn't see, + a requirement-detail modal on the compliance matrix. Motivated by two confirmed defects on a
live §2.4 doc: **§2.4.1 dropped** (recall miss on a near-duplicate sibling) and **§2.4.3 split** (its
`(CDRL A005)` tail emitted as its own node). Both arrive as well-formed nodes, so `parseHrlrNodes`/`resolveGraph`
were blind to them.

- **Coverage-gap detector** (`utils/dara/hrlr/resolve.ts`) — scans the raw source for its own outline markers
  (decimal/lettered/parenthetical), diffs against the markers the model emitted, records every missing section
  as a `CoverageGap` on the graph. Logs per-gap + a summary count (even at 0). Catches the §2.4.1 omission.
- **Same-marker fragment detector** (`resolve.ts`) — groups nodes by marker; short/parenthetical/CDRL/see-section
  nodes sharing a marker are flagged `PROBABLE_SPLIT` + merge candidate (longest sibling). Flag only, no
  auto-merge. Catches the `(CDRL A005)` mis-split.
- **Prompt reinforcement** (`hrlr/prompt.ts`) — `EXTRACTION COMPLETENESS RULES` appended to
  `SOLICITATION_GUIDANCE` (C-1 emit every numbered item / no near-dup skips; C-2 fold bare cross-ref tags in).
- **Requirement-detail modal** (`components/dara/RequirementDetail.tsx` + `ComplianceMatrix.tsx`) — repurposed a
  dead component into a click-to-open modal: verbatim text, needs-review banner (flags + mis-split),
  classification, **source & provenance incl. the source DOCUMENT filename**, and the HRLR logic graph. Fed from
  the `hrlr` JSONB + a `documentId→filename` map on the sol page.

**Surfacing.** Gap count on `renderMatrix` (even 0), the runner log, and `ShredSummary.coverageGaps`. Fragment
flags persisted in the `hrlr` JSONB. `resolveGraph` took an optional `sourceText?` (backward-compatible; absent
→ coverage check skipped → `[]`).

**Verified.** Live §2.4 run: 4 nodes, 0 gaps, 0 fragments, `(CDRL A005)` folded into 2.4.3. Deterministic
negative control (no API, drops 2.4.1 + splits CDRL): both detectors fired correctly. Modal is build-verified,
**not yet clicked live**.

**To watch / do next.**
- **Detectors run on the NEXT shred only** — existing matrices won't retroactively show gaps/fragments until
  regenerated (regenerate = clear the matrix first; the shred no-ops into a non-empty matrix).
- **Modal not yet exercised in a browser** — open a sol with requirements and click a row to confirm.
- **Review-queue UI still absent** — coverage gaps + fragment flags + numbering conflicts have no surfaced list
  (matrix shows a gap COUNT only). All data is in the `hrlr` JSONB / graph.
- Optional next: bounded **gap re-extraction** (deliberately NOT built this session), fragment **auto-merge**
  affordance, same guards for **response HRLR**.
- **Security backlog remains #1** (DARA-021 rate limiting, DARA-022 Next 15, DARA-023 branch protection).

**Supersedes nothing** — this sits ON the 2026-07-10 HRLR shred (§0 below) as a scan-integrity layer.

## 0 (2026-07-10). HRLR shred (requirement-graph reconstruction; replaces the flat shred)

Commit `e373498` on `main`, **pushed + deployed to prod** (`dpl_Agw9a9mQhg14ruGePy6h9xB2ExBN`,
`ci-dara-9499lntga`, READY / production, aliased `dara.crucibleinsight.com`). **One prod migration** —
`20260710120000_requirement_hrlr` (additive `hrlr JSONB` on `dara_requirements`) — applied as owner
(`prisma migrate deploy`) BEFORE the deploy; **no RLS file** (table grants cover new columns). `migrate status`
confirmed the 2026-07-09 span migration was already applied → no drift. `tsc --noEmit` + `pnpm build` clean.
Full decision log: `BUILD_STATUS.md` §-4.

**What it is.** "Generate from solicitation" now runs **Hierarchical Requirement Logic Resolution** instead of
the flat whole-document list. One call reconstructs a requirement **graph** — typed nodes (STANDALONE /
PARENT_WITH_CHILDREN / CHILD / PARENT_AND_CHILD / UNRESOLVED), parent/child links, cardinality/Boolean
**satisfaction rules** (ALL_OF / ANY_OF / AT_LEAST_N / EXAMPLES_OF / …), evaluation scope, and
**verbatim-verified source provenance** (unfound text is flagged, never dropped). Three identities stay
separate: the document's number is evidence, the row id is the stable logical id, `hrlr.syntheticPath` is
display; contradictory source numbering is preserved + flagged.

**Key files.** Core (pure, app-free) in `utils/dara/hrlr/` — `types/prompt/parse/resolve/matrix.ts` + `run.ts`
(standalone: `npx tsx utils/dara/hrlr/run.ts --in <file> --kind solicitation|response`). `utils/dara/
requirements.ts` `shredRequirements` rewritten to run the pipeline + persist the graph (reuses span/
decomposition columns; new `hrlr` JSONB bundle). Worker signature unchanged (`passes.ts:754`).

**Safety (why this shouldn't repeat sol-18/19 or the two prior failures).** One-shot, **no resumption loop**
(can't infinitely requeue); 240s timeout; throw→job-fails→poll releases. Container/parent nodes insert
`complianceStatus:not_applicable` → **excluded from the compliance sweep** (only `compliance`+`not_assessed`
leaves grade). **No-ops into a non-empty matrix** (regenerate = clear first).

**To watch / do next.**
- **First real dense-RFP run on prod is the true test.** Trigger it on ONE solicitation with an empty matrix
  and confirm the job COMPLETES (guards make a stall self-clear rather than pin the poll).
- **Matrix UI** still shows rows flat grouped by `source` — no tree / satisfaction badges / synthetic path /
  review queue (flags + numbering conflicts) yet. All data is in the `hrlr` JSONB; UI is the follow-on.
- **Response HRLR** built + proven, no app home yet (needs a response-graph store + action + UI).
- **Security backlog remains #1** (DARA-021 rate limiting, DARA-022 Next 15, DARA-023 branch protection).

**Supersedes** `NEXT_STEPS_span-anchored-extraction.md` (that windowed/resumable design is moot; its schema
Prompt 1 + `spans.ts`/`extract-prompt.ts` already landed and are reused). The intervening 2026-07-09
span-anchored commits (`43fd1ee`→`2c9a9b6`) were never written up in this handoff; HRLR sits on and replaces
that direction.

## 0 (2026-07-08). Admin AI cost dashboard + per-run cost + sidebar nav + usage-ledger fix

All committed + **pushed + deployed to prod** (commits `1207e27` → `5728f07`; last deploy
`dpl_DCY7rVgfwQH1LurCx9mYeZKX9Mtv`). Builds clean (`tsc --noEmit --skipLibCheck`). Context: this session
built on the **admin AI foundation** shipped just before it (`a23d747` "usage ledger + per-capability model
overrides + admin split", migration `20260708130000_ai_usage_and_capability`).

**ONE prod migration this session** — `20260708200000_ai_pricing_and_run_id` (additive: `run_id` on
`dara_ai_usage_log` + new `dara_ai_model_price` table) — applied as owner (`prisma migrate deploy`) **+** its
RLS `prisma/security/2026-07-08_ai_model_price_rls.sql` (`apply-sql.ts`) BEFORE the code deploy. Verified in
prod: table + `run_id` exist, `dara_admin` full CRUD, `dara_app` no grant (fail-closed), `dara_admin_all` policy.

1. **Usage ledger was empty → root cause fixed (`1207e27`).** The AI usage ledger recorded **zero** rows because
   **`utils/dara/direct-review.ts` (the one-click Direct AI Review engine) never called `logUsage()`** — it was
   the only `complete()` call site missed when the ledger was wired in `a23d747` (every other capability — shred,
   compliance_sweep, review_pass, evaluation, amendment_diff, annotated_export — was wired). Now logs
   `direct_review` on success + failure. (Diagnosis: table/RLS/grants/`prismaAdmin` env were all healthy; the
   write simply never happened, so there was no `[usage] failed to record` error either.)
2. **AI run cost estimation (`3732e4b`).** Estimates the USD cost of each AI run from the ledger.
   - **Pricing** lives in `dara_ai_model_price` (USD **per 1M tokens**), refreshed weekly by a new cron
     **`/api/cron/pricing`** (Mon 06:00 UTC, `vercel.json`, CRON_SECRET-gated) from the **LiteLLM community feed**
     (`utils/dara/pricing.ts`; feed URL overridable via env `AI_PRICING_FEED_URL`). Its bare model keys match
     what we send/record, so cost is an exact `(provider, model)` lookup. **No provider has an official pricing
     API** — the feed is the pollable substitute (user chose "community feed + operator override"). Seeded **224
     rows** at launch (23 anthropic / 54 google / 147 openai; `claude-sonnet-4-6` $3/$15, `claude-opus-4-8`
     $5/$25, `claude-haiku-4-5` $1/$5). Operator **`source='override'`** rows are **immune** to the weekly refresh.
   - **Per-run attribution:** new `run_id` on the ledger, set via **AsyncLocalStorage** (`utils/dara/run-context.ts`)
     — `withRunContext('job:<id>')` wraps the worker dispatch in `passes.ts:processReviewJobs`, so every
     `logUsage()` deep in the engines is tagged with **no signature threading**. Only runs recorded **after this
     deploy** have a `run_id` (older rows null → excluded from the per-run view).
   - **Cost is NOT stored on the ledger** — it's computed at read time from the price table
     (`costOf()`/`getPricingMap()`), same as the usage report. `getUsageReport()` now returns est. cost per
     capability/model, a **top-25 cost-per-run** breakdown, and `unpricedModels` (usage with no price → surfaced
     for overrides).
   - Admin **`/app/admin/usage`** gained cost cards/columns, a cost-per-run table, and a **Model pricing manager**
     (`app/app/admin/ModelPricing.tsx` + `pricing-actions.ts`): edit overrides, delete, manual "Refresh from
     feed", and prompts for unpriced models. Memory: `ai-usage-cost.md`.
3. **Admin console nav moved into the sidebar (`8682097`).** Deleted the horizontal `app/app/admin/AdminNav.tsx`
   tab bar; `components/layout/PlatformAdminSidebar.tsx` now carries route-aware links in two sections —
   **Operations** (Overview / Background jobs / AI usage) and **Configuration & accounts** (Platform AI / Gating /
   Accounts / Users / Administrators) — with active-state highlighting (`exact` match for Overview + the in-page
   section links, prefix match for the sub-pages). **Gating/Users/Administrators keep their `#gating`/`#users`/
   `#admins` anchors** (Accounts is hashless — its section has no `id`). `app/app/admin/layout.tsx` is now a plain
   `requirePlatformAdmin()` guard + max-width wrapper (no nav).
4. **Admin dashboard (`5728f07`).** `/app/admin` (`app/app/admin/page.tsx`) now **opens with a dashboard**: 4 stat
   cards (Active jobs · Tokens today · Est. cost today · Companies), a **Live jobs** panel (inline `killJob` server
   action — defined in this file, revalidates `/app/admin` — plus a "Kill all →" **link** to `/app/admin/jobs`),
   an **AI usage — today** panel (per-company tokens + cost, priced from `getPricingMap`), and a **read-only**
   per-capability **AI keys & models** panel (links to `/app/admin/ai` to edit). The existing **Default gating /
   Accounts / Users / Administrators** sections + all their server actions are **preserved verbatim below** the
   dashboard (still targeted by the sidebar hash links). `estimatedCostUsd` does **not** exist on the ledger — the
   dashboard prices today's usage via `getPricingMap`/`costOf`, not a stored column.
5. **Housekeeping (`3132bd4`).** `.gitignore` now excludes `_*.mjs` (scratch scripts) + `.claude/worktrees/`.

## 0 (prior). 2026-07-07, part 2 — DARA-025 BOLA sweep + public-page branding + password-reset finding

Not yet committed or deployed. **No migrations** (code-only). Builds clean (`tsc --noEmit` + `pnpm build`).

1. **DARA-025 (cross-department BOLA) — FIXED.** Every child mutation/delete server action in
   `app/app/solicitations/[id]/page.tsx` now gates the parent sol as viewable AND ties the child to that
   `solId`. Local-fetch actions (`updateRequirement`, `saveMatrixRow`, `deleteRequirement`, `updateReview`,
   `deleteReview`, `deleteSolDoc`, `deleteReviewDoc`, `deleteAmendment`) scope their `findFirst` by
   `solicitationId: solId` (or `review: { solicitationId: solId }`); the six delegating actions
   (`runReviewAction`, `rerunPassAction`, `regenerateResultAction`, `archiveResultAction`,
   `applyChangeAction`, `enqueueReconcileAction`) call a new shared **`requireChildInSol(solId, user, kind,
   childId)`** helper that resolves review/pass/result/amendment/change up to `solId` first. The `/annotated`
   route + the list-page delete/dept actions were already safe. Register updated (`security-content.ts`
   DARA-025 → Remediated; `SECURITY_BACKLOG.md`).
2. **Public /security + /legal branding.** New `components/dara/PublicChrome.tsx` wraps both pages with a
   branded header (dara-logo.png + "DARA" / gold "Crucible Insight", home link, Sign in) and footer
   (© The Daniel Group LLC + Security · Terms & Privacy) — they were bare after the marketing chrome was
   stripped. ChromeGate still bars the full marketing nav on these routes; this is a dedicated light chrome.
3. **/legal contact lines** changed to `admin@crucibleinsight.com` (no company name) on both the Terms and
   Privacy "Questions about…" lines.
4. **DARA-046 (NEW, High) — password reset was broken → FIXED.** `resetPasswordForEmail` ran on the PKCE SSR
   client, so the recovery email's `{{ .TokenHash }}` was a `pkce_…` code `/auth/confirm`'s `verifyOtp` can't
   verify → redirect to `/signin` (broken for everyone, worse via Outlook SafeLinks / other device). **Fixed**
   by firing the reset from a `flowType:'implicit'` supabase-js client (anon key) so the token is a plain OTP
   hash verifyOtp accepts cross-device (+ early-return on invalid email). **Confirm-signup (`signUp`) had the
   same PKCE bug and was fixed the same way** via a shared `newImplicitAuthClient()` helper. See §9 for detail,
   a test recipe, and the remaining magic-link/email-change follow-ups. Register updated to Remediated.

**Operator steps now DONE (user confirmed 2026-07-07):** Supabase Manual Linking enabled + all 12 email
templates pasted.

## 0 (part 1). Earlier 2026-07-07 — Settings consolidation, public Security/Legal pages, checkbox-only agreement

Committed (`b3428d3` → `a15ffd5`) + deployed. No migrations (avatar/legal columns already nullable). Full
detail in `BUILD_STATUS.md` §-1; summary:

1. **`/app/settings`** is now a tabbed hub — Profile, Two-Factor, Legal (everyone); Billing, AI Configuration
   (company_admin only). `?tab=` selects the initial tab. Old routes (`/app/account/profile`,
   `/app/account/security`, `/app/billing`, `/app/account/legal`) redirect to the matching tab — kept alive
   deliberately since `supabase/templates/recovery.html` hardcodes `/app/account/profile` and the dashboard
   trial banner links `/app/billing`. New files: `app/app/billing/{actions,BillingView}.tsx` (split out of the
   old billing page so it composes as a tab). Sidebar Account section is now just **Settings** (+ **Admin**).
2. **`/security`** — Security & Compliance is now a public page (no sign-in). Old `/app/security` redirects
   there; `CuiBoundaryNotice`/`CuiBoundaryModal` links updated. `/app/security/plan` (SSP/POA&M) is unchanged,
   still in-app/authenticated.
3. **`/legal`** — new public page, Terms of Service + Privacy Policy tabs (plain-language copy, distinct from
   the binding Legal Document Set signed at onboarding/reviewed under Settings → Legal). Old `/security/tos`
   and `/security/privacy-policy` redirect here. Best-effort print-block (`@media print`) — not a hard
   guarantee, browsers can't be fully stopped from printing/screenshotting.
4. **Onboarding agreement** — removed the "type your full legal name" field. Checking the single agreement
   checkbox immediately calls `acceptLegal()` (no name), so the recorded `tosAcceptedAt` is the exact moment
   the box was checked. `acceptLegal()` no longer accepts/writes a signed name (`tosSignedName` column stays,
   just unused). Same simplification in the Settings → Legal re-acceptance flow.
5. **Sign-in page** — added Security / Terms & Privacy footer links (desktop brand panel + mobile-only
   equivalent).
6. Verified: `tsc --noEmit` + `pnpm build` clean; `next start` smoke pass confirmed `/security` and `/legal`
   return 200 with expected content, all four+three old routes 307-redirect correctly, and `/app/settings`
   still requires auth.

---

## 1. Deploy model (READ FIRST — unchanged)

- **Prod = `main`, deployed MANUALLY.** Every time: `git push origin main` → `vercel deploy --prod --yes`
  → confirm the new SHA is `READY` + `target: production` via the Vercel MCP `list_deployments`.
- **GitHub→Vercel auto-deploy is flaky/off** — do not wait on it; always deploy via CLI yourself.
- Vercel CLI **is** installed, authed as `islanista-7787`; `.vercel/` linked (project
  `prj_I6CLDhGJlbjro2Mc67i1AyyHpciP`, team `team_hluvXIDuWYVTRTyXnqxTbfWg`). Deploys show `gitDirty:1`
  only because of the untracked `tsconfig.tsbuildinfo` — source still == the commit.
- **Schema changes: migrate BEFORE the code deploy.** `pnpm prisma migrate deploy` → new `dara_*` table
  also needs its RLS applied via `npx tsx prisma/security/apply-sql.ts <file>` → then deploy.
  **This session applied one migration** (`20260708200000_ai_pricing_and_run_id`) + its RLS
  (`2026-07-08_ai_model_price_rls.sql`) to prod as owner, in that order, before the code deploy — the
  established two-step. `prisma migrate status` showed a clean single-pending before applying (26 applied +
  1 pending); after deploy all are applied. The prior `20260708130000_ai_usage_and_capability` (from the
  admin AI foundation `a23d747`) was already applied.
- **`.env.local` points at the REMOTE (prod) Supabase.** No local DB. `withTenant` interactive
  transactions can throw **P2028** from this dev machine (pooler latency) — verify tenant DB flows on
  prod, or with a throwaway non-interactive `pg` script on `DIRECT_URL`. `.env.local` also has the
  Stripe secret + `APP_KEY`.
- Every-minute Vercel **cron only runs on prod**; a review/shred kicked on preview is processed by
  prod's deployed code. Verify job *completion* on prod.

---

## 2. What shipped

### 2.0 Most recent (2026-07-06, night) — invites verified, account self-service, avatars, dept editor, email templates

Commits `21fcae9` (account + dept editor + templates + avatar migration) → `6eeb625` (avatars in Teams/welcome).
Both DEPLOYED to prod. **One prod migration applied** (`20260707000000_user_avatar` — additive `avatar_url` on
`dara_users`; existing RLS covers it) + **new public Storage bucket `dara-avatars`** (created via
`node --env-file=.env.local scripts/create-avatars-bucket.mjs`). See memory `account-self-service.md`.

1. **Invite flow VERIFIED working — DARA-045 link side CLOSED.** The earlier dead link (`/signin/...#access_token=…`)
   was Supabase's *default implicit-flow* template returning the session in the URL `#fragment`, which no server
   route can read (our `/auth/confirm` reads `?token_hash=`, `/auth/callback` reads `?code=`). **Fix = Option A,
   operator config (done this session):** Site URL = bare `https://dara.crucibleinsight.com`, redirect allowlist
   `…/**`, and the branded token_hash "Invite user" template. A test invite now lands on `/welcome` signed in.
   Delivery is via **Resend Custom SMTP** (operator-configured), so the built-in rate limit no longer applies.
2. **Account self-service — `/app/account/profile`** (new sidebar "Profile" link, 3 panels): edit display name +
   upload/remove **avatar**; **set/change password** (`updateUser` — fixes OTP-invited users with no password);
   **link/unlink Google** (`linkIdentity`/`unlinkIdentity`, client-side). All audited (`account.*`). Server actions
   in `app/app/account/profile/actions.ts`. The **Reset Password** email lands here so users set a new password.
3. **Avatars wherever an account circle shows** — shared `components/dara/Avatar.tsx` (image-or-initials); rendered
   in the sidebar, the **Teams member list**, and the welcome screen (uploaded avatar preferred over the OAuth
   picture). Public bucket (non-CUI, public read, no signed URLs); uploads via service-role with magic-byte checks
   (`utils/dara/avatar.ts`). Onboarding wizard + platform-admin sidebar intentionally left initials-only.
4. **Per-solicitation department editor on the LIST** — `components/dara/DepartmentEditor.tsx` modal +
   `setDepartmentsAction` in `app/app/solicitations/page.tsx`, gated to **admin + creator**
   (`canManageDepartments` — user chose to keep the creator, not admin-only). Mirrors the Overview-tab card.
5. **12 branded Supabase email templates** in `supabase/templates/` (+ `README.md` slot map): confirm-signup,
   magic-link, email-change, recovery, reauthentication, and 7 security notices. All link-based ones use the
   `/auth/confirm?token_hash=…` flow (NOT the implicit `#access_token` flow). **Must be pasted into the Supabase
   dashboard to take effect** — the folder is source-of-truth only.

⚠️ **Pending operator (Supabase dashboard):** (a) **enable Manual Linking** so "Connect Google" works;
(b) **paste the 12 email templates**. Everything else above is fully live.

### 2.1 Earlier session (2026-07-06) — security fixes, 2FA, legal/TOS, invites, auth

Commits `258a5eb` → `1754cf6`. All DEPLOYED through `2e2e74c` (last two are register-text only). **Two prod
migrations applied that session** (`20260706000000_user_mfa`, `20260706010000_user_legal_acceptance`).

1. **Security quick-wins** (`258a5eb`) — DARA-026 (`getDaraUser` fail-closed on `isActive`; layout uses new
   `findDaraUserRaw` so the disabled screen still renders), DARA-027 (sol delete now `removeStored`s all
   CUI blobs), DARA-028 (CSV formula/DDE injection escaping), DARA-030 (audit `matrix.export`/`report.export`/
   `review.pass.rerun`), DARA-034 (cron `CRON_SECRET` mandatory in prod). **Unified the findings register:**
   the re-audit's `SEC-01..23` are now `DARA-021..045` in `security-content.ts` + `SECURITY_BACKLOG.md`.
2. **TOTP 2FA — DARA-031** (`8fed6c3`, + onboarding step `a5e1d9e`) — Supabase-native MFA (AAL2), NOT a
   custom system. Opt-in at `/app/account/security`, login challenge `/auth/2fa-challenge`, middleware gates
   `/app` on AAL2, 10 bcrypt backup codes, signed httpOnly recovery marker for the backup path. Also an
   optional step in the onboarding wizard. TOTP factor enabled in Supabase (operator, done). See `mfa-totp.md`.
   **Still opt-in, not enforced** — tenant-wide enforcement is the remaining step.
3. **Legal / TOS acceptance** (`9418c7e`) — required "Agreement" step in onboarding + `/app/account/legal`
   viewer (sidebar "Legal"). Source `.docx` in `public/legal/`; `node scripts/gen-legal.mjs` regenerates
   `utils/dara/legal-content.ts` (v1.0). Acceptance = typed name + checkbox → `acceptLegal()` writes
   `dara_users.tos_*` + immutable `legal.accept` audit (version, name, IP). See `legal-tos.md`.
4. **Team invitation Resend** (`18000bb`) — `resendInvitation` next to Revoke (refresh expiry + re-send).
   **⚠️ but see §8 — invite emails don't reliably send on Supabase built-in email (DARA-045).**
5. **ChromeGate fix** (`5e0aa4b`) — the marketing navbar/footer was bleeding onto full-screen auth/setup
   pages (the `/auth/2fa-challenge` "Pricing/Account/Sign out" bar, plus `/onboarding` + `/welcome`). Now
   bares `/app`, `/signin`, `/auth`, `/onboarding`, `/welcome`.
6. **Auth email-link flow — `/auth/confirm`** (`2e2e74c`) — invite links failed (`otp_expired` → `/signin`)
   because `/auth/callback` only does the PKCE `?code` exchange, which doesn't work for admin invites (no
   browser verifier). Added `/auth/confirm` (`verifyOtp` token_hash) — works for invite links, no verifier /
   allow-list dependency. Shared post-auth provisioning extracted to `utils/dara/auth-finalize.ts`. Invite
   template link now points at `/auth/confirm`. Invite-send errors now logged + surfaced to the admin.
7. **Branded invite email template** (`e2a9b11`) — `supabase/templates/invite.html` (navy/gold, table-based).
   Committed + wired in `config.toml`; **must be pasted into the hosted Supabase dashboard** to take effect
   (Auth → Email Templates → "Invite user"). NOTE: since `2e2e74c` its link uses the `/auth/confirm` token_hash
   format — re-paste the current version.

### Evening batch (2026-07-06) — compliance-matrix reliability + New Solicitation path picker (`6b12d74` → `c282963`)

8. **Shred timeout → empty matrix + infinite `_rsc` poll — FIXED** (`c282963`). The "Generate from solicitation"
   shred made ONE AI call for up to **16000** output tokens; on a requirement-dense RFP that generation exceeded
   the **240s** provider timeout, threw before writing any row, and left the JobQueue row stuck `running` — the
   page then polled `/app/solicitations/<id>?_rsc=…` forever (hit on sol 18 + 19). Fix: `SHRED_MAX_TOKENS`
   16000→8000 + the shred is now **resumable across worker ticks** (first tick extracts, later ticks only run
   gap passes, reports `exhausted`, 800-req cap; worker requeues while `!exhausted`) so no single call nears
   240s and a dense RFP finishes across ticks. Also `reapOrphanedJobs` wrapped in try/catch so a dead job always
   surfaces as `failed` (releasing the poll) instead of pinning it. Files: `utils/dara/requirements.ts`,
   `utils/dara/passes.ts`. **Diagnosis note:** output-bound (requirement density), NOT input size — input is
   capped at 50k words; larger-but-sparser RFPs shredded fine. See BUILD_STATUS §0 "Later same day".
9. **Compliance-check grading could loop forever — FIXED** (`6b12d74`). `mapDetermination` wrote any non-exact
   AI determination back to `not_assessed`, so `runComplianceJob`'s `checked===0` guard never tripped and the
   job requeued every tick. Now normalizes the determination + maps unknowns to `partial` (terminal), and the
   job terminates on **net progress** (not-assessed count before vs after). Files: `evaluator.ts`, `passes.ts`.
10. **New Solicitation review-path picker — SHIPPED** (`6b12d74`, `components/dara/UploadAndReview.tsx`). First
    screen is two explanatory cards, **Direct AI** vs **Color Team**, chosen before the sol is created. Direct AI
    uploads a response draft now; Color Team hides the proposal dropzone (per-review drafts later). Replaces the
    buried "Advanced → Switch to Color Team" checkbox. (This was backlog §4.5 — now done.)
11. **Signin footer copyright** (`2ceb0ce`) — now "© 2026 The Daniel Group LLC". **Open follow-up:** privacy
    policy + TOS pages (`app/security/privacy-policy`, `app/security/tos`, `security-content.ts owner`) still say
    "Crucible Insight LLC" — user asked to reconcile these to "The Daniel Group LLC"; not yet done.

---

## 3. ⚠️ Gotchas that WILL bite if forgotten

- **Deploy manually every time** (§1); confirm READY on prod before assuming a change is live.
- **`@react-pdf/renderer`, `mammoth`, AND `docx` must stay in `serverComponentsExternalPackages`**
  (`next.config.js`). The `/report/pdf` and `/annotated` routes + matrix `.docx` action only execute the
  lib at request time, so a green `pnpm build` does NOT prove they render — smoke-test the helper or hit the route.
- **`AI_TIMEOUT_MS` (utils/dara/providers.ts) must stay ~240s.** Full shred/review runs 150-200s; 120s
  aborted them mid-generation.
- **The compliance matrix (requirements) comes from the SHRED**, a separate AI job from the review.
- **Personas now feed the review prompts.** Editing/activating a persona changes review output. No-persona
  companies get an unchanged prompt. The color-team Run gate ("≥1 active persona") is meaningful again.
- **The `/annotated` route makes a live AI call** (`maxDuration=300`) and has **no rate limit / trial gate**
  (DARA-021) — flagged in the backlog.
- **`getDaraUser` is now fail-closed on `isActive`** (returns null → treated as unauthenticated). The **app
  layout uses `findDaraUserRaw`** on purpose so a deactivated user still gets the AccountDisabled screen.
  Don't switch the layout back to `getDaraUser` or you'll bounce disabled users to signin.
- **Middleware gates `/app` on Supabase AAL2** (`getAuthenticatorAssuranceLevel`). A user with a verified
  TOTP factor but an AAL1 session is redirected to `/auth/2fa-challenge`. The **backup-code path** sets a
  signed httpOnly `dara-mfa` marker (HMAC of userId via APP_KEY, Web-Crypto so it's Edge-safe) that the
  gate also accepts; cleared on sign-out/disable. `mfa-cookie.ts` must stay node:crypto-free (Edge bundle).
- **2FA needs the Supabase project TOTP factor ON** (done). 2FA + TOS are **opt-in, not enforced** app-wide.
- **Email links use TWO routes:** `/auth/callback` (PKCE `?code`, OAuth/magic-link) and `/auth/confirm`
  (`verifyOtp` token_hash, invite/confirmation). Shared provisioning in `utils/dara/auth-finalize.ts`.
- **Legal docs:** edit `.docx` in `public/legal/`, run `node scripts/gen-legal.mjs`, commit both. Bumping
  the ToS "Version x.y" line auto-prompts users to re-accept on `/app/account/legal`.
- **Invites now work (DARA-045, §8)** via Resend SMTP + the `/auth/confirm` token_hash flow. Do NOT revert any
  email template to Supabase's `{{ .ConfirmationURL }}` — that's the implicit `#access_token` flow our routes
  can't read. Site URL must stay the **bare origin** (`{{ .SiteURL }}/auth/confirm` links break with a path).
- **Avatars live in a PUBLIC bucket `dara-avatars`** (non-CUI; public read, no signed URLs). Uploads go through
  the **service-role** client with magic-byte checks (`utils/dara/avatar.ts`); the DB `avatar_url` is a public
  URL with a `?v=` cache-bust. Shared render via `components/dara/Avatar.tsx`.
- **"Connect Google" needs Manual Linking ON** in Supabase (operator). Until then the button fails gracefully
  with a "not enabled yet" message — the rest of `/app/account/profile` works regardless.
- **AI cost is an ESTIMATE computed at read time**, never stored on the ledger. `getUsageReport` / the admin
  dashboard join `dara_ai_usage_log` tokens against `dara_ai_model_price` via `costOf()`. A model with usage
  but **no price row** contributes $0 and is surfaced under "unpriced models" on `/app/admin/usage` — add an
  operator **override** there to price it. Don't expect a `estimatedCostUsd` column; there isn't one.
- **Weekly pricing cron** `/api/cron/pricing` (Mon 06:00 UTC) is **CRON_SECRET-gated** exactly like
  `/api/cron/passes`; it refreshes only `source='feed'` rows (operator `override` rows are never touched).
  Feed = LiteLLM JSON (override via `AI_PRICING_FEED_URL`). Runs on prod only.
- **`run_id` is forward-only.** It's set from an AsyncLocalStorage context wrapped around the worker dispatch
  (`passes.ts:processReviewJobs` → `withRunContext('job:<id>')`); rows written before the 2026-07-08 deploy
  have `run_id=null` and don't appear in the per-run cost view. Inline (non-worker) AI paths also get null.
- **Admin nav lives ONLY in `PlatformAdminSidebar`** now (AdminNav.tsx is deleted). Adding an admin sub-page
  means adding an `ITEMS` entry there; the in-page Overview sections (Gating/Users/Admins) are `#hash` links
  back to `/app/admin`, so keep those section `id`s intact on `app/app/admin/page.tsx`.

---

## 4. Backlog (non-security)

1. **PDF-export minor format polish** — user reported small issues, **deferred by them** ("tweak later").
2. **SAM.gov import** — dashboard button disabled; blocked on a SAM.gov API key/entitlement (operator).
3. **Annotated export follow-ups** — per-direct-review persona selector; annotate the *original* uploaded
   `.docx` in place (preserve formatting) instead of rebuilding from text; batch anchoring for huge finding sets.
4. Nice-to-haves: rename/edit metadata from the solicitations LIST; richer built-in persona templates.
5. ~~**New Solicitation — review-mode path selection up front**~~ — **SHIPPED 2026-07-06** (`6b12d74`), see §2.10.
   First screen is now two explanatory cards (Direct AI vs Color Team); Color Team hides the response-doc upload.
6. **Administrative/format requirements are over-escalated to technical findings (review classification).**
   _Reported 2026-07-07 (user)._ The AI review flags pass/fail **administrative format** requirements as deep
   **technical assessment** findings that demand a written declaration/rationale. Example: Amendment 0001 added
   "12-point Times New Roman for all volumes"; the review surfaced it as a technical finding asking the offeror
   to *declare* compliance. **Desired behavior:** keep DETECTING these requirements (don't stop scanning), but
   route them to the **compliance matrix as pass/fail**, not the holistic technical review. For each such
   admin/format item: (a) **auto-verify from extracted text where possible** (e.g. page/section presence, word
   counts) → set compliant/non-compliant; (b) where automated verification is **not possible from extracted
   text** (font, point size, margins, line spacing — not recoverable from our text extraction) → mark it
   **"manual verification required"** with a concrete offeror action + citation (e.g. "Confirm all body text is
   12-pt Times New Roman in each volume before converting to PDF — Amendment 0001, Addendum to 52.212-1"),
   **not** a technical finding requiring a declaration. Likely touches: shred disposition classification
   (`administrative` vs `scored`, `utils/dara/requirements.ts`), the compliance sweep
   (`runComplianceSweep`/`evaluator.ts` → add a `manual_verification` status), and the pass prompts so format
   requirements aren't pulled into the technical passes (`utils/dara/passes.ts`/`prompt.ts`). May need a new
   `ComplianceStatus` enum value (`manual_verification`) + matrix UI affordance.
7. **AI cost/observability follow-ups (new 2026-07-08, all optional polish).**
   - **Verify the weekly pricing cron fires** — first run is Mon 06:00 UTC; until then the 224 seed rows stand.
     Sanity-check on prod after the first fire (Vercel cron logs / `dara_ai_model_price.updated_at`).
   - **Per-run labels are `job:<id>`** — readable but opaque. Could resolve to the solicitation/company for the
     cost-per-run table (needs a join from job id → payload entity). Inline paths (regenerate, annotated export)
     have **no** run context yet — wrap them in `withRunContext` if you want their cost attributed to a run.
   - **Pricing accuracy** — LiteLLM is community-maintained; spot-check the seeded Anthropic rates against
     Anthropic's page, and add operator overrides on `/app/admin/usage` for anything the feed lags or omits.
   - **`getPricingMap()` runs per usage/dashboard render** (small table, fine now) — cache if it grows.
8. **Questions / clarifications / inconsistency generator (NEW 2026-07-09, requested by user).** A new AI
   capability that reads the solicitation (and the shredded requirements matrix) and produces a structured
   **list of questions to submit to the Government** during the Q&A / RFI window — the deliverable a capture
   team sends to the Contracting Officer before the question-cutoff date. Three question classes it must
   generate: (a) **requirement clarification** — where an obligation is under-specified, ambiguous, or missing a
   value the offeror needs to respond (undefined quantities, unstated period of performance, "TBD" fields,
   deliverable formats not specified); (b) **solicitation verbiage** — where the language itself is unclear,
   contradictory to standard usage, or open to multiple readings that change the response; (c) **logical
   inconsistency** — where two parts of the solicitation conflict (e.g. Section L page limit vs. Section M
   content the offeror must cover; a PWS task with no corresponding evaluation factor; an amendment that
   changes a value one place but not another; due dates/quantities/thresholds that disagree across documents).
   **Desired shape (design later — this is on HOLD behind the shred pre-processor redesign):** likely a new
   engine `utils/dara/questions.ts` + prompt builder (`buildQuestionsPrompt`/`parseQuestions` in `prompt.ts`),
   run as its own JobQueue capability (`capability: 'questions'`, so it logs to the usage ledger like the
   others) over `docType='rfp'` text + the current `Requirement` rows for cross-referencing. Each generated
   question should carry: the **class** (clarification / verbiage / inconsistency), the **question text**
   (ready to paste into a Q&A submission), the **citation(s)** it arises from (section/paragraph, and for
   inconsistencies BOTH conflicting locations), and a short **why-it-matters** rationale. Surface on the
   solicitation workspace (probably a new tab or a panel on the Compliance/Overview tab) with export (CSV /
   DOCX, reuse the matrix-export plumbing) so the team can hand it to the CO. Reuse the injection-fencing +
   tolerant-salvage-parse patterns already in `prompt.ts`; no schema work needed if questions are generated
   on demand and exported (persist as a new `dara_*` table only if we want them saved/edited/tracked — decide
   at design time). Coordinate with the requirements pre-processor redesign (currently held) since both read
   the same shredded matrix.
9. **Evaluation-Only view (NEW 2026-07-13, requested by user — HOLD, come back later).** A limited/filtered
   view of the compliance matrix that presents requirements **by evaluation criteria only** — i.e. the Section M
   evaluation factors and the Section L instructions that are *called out for evaluation*, without the full
   administrative detail. Strips the admin/compliance bulk (SAM/CAGE, reps & certs, format/logistics —
   `disposition='administrative'`, and likely most `disposition='compliance'` rows) so a proposal lead sees only
   what actually **scores** plus the L instructions governing those factors. **Depends on** the Section L → M
   wiring (three-capability session, item under active work) — the "governing factor" link is what lets this view
   show each scored factor with its contributing L instructions and hide everything else. Likely a view toggle on
   the Compliance tab (e.g. "Evaluation only" vs "Full matrix"), filtering `matrixRows` to `disposition='scored'`
   (Section M factors) + their linked Section L instruction rows; no schema change beyond the L→M link. Reuses the
   existing `ComplianceMatrix` rendering with a narrower row set / fewer columns. **Do not build yet** — revisit
   after L→M wiring lands.

---

## 4a. ★ Span-anchored requirement extraction (compliance-matrix redesign)

_Design, in revision (2026-07-09). Full plan: `NEXT_STEPS_span-anchored-extraction.md`._ Replaces the shred
with **span-as-identity** `(documentId, spanStart, spanEnd)` + a verbatim-verification gate + a partial unique
index, so duplication/hallucination are solved structurally; adds user-initiated **decomposition** of compound
requirements. This is the redesign the shred pre-processor (item 6/held) is held for. Delivered as a **6-prompt
chain** (schema → deterministic utils → extraction pipeline → decomposition → exclusion predicate → matrix UI).
**Do not run Prompt 3 (pipeline rewrite — highest-risk step; a prior attempt caused a prod stall + revert)
until the required fixes in the next-steps doc are folded in** — critically (1) window-index resumption +
bounded parallelism to survive the 300s worker, (2) normalization-tolerant `verifySpan` returning RAW offsets
(exact match drops PDF-extracted rows silently), (3) payload-accumulated spans + merge-at-end (cross-tick
resumption otherwise breaks the global `mergeSpans` and duplicates boundary straddlers). Plus `skipDuplicates`,
restored per-window `logUsage`, visible `failedWindows`, the `parseTiling` residual fix, `timestamp(3)` not
`TIMESTAMPTZ`, and a wider Prompt-5 grep. Separate from item 6 (does NOT add the `manual_verification`
disposition).

---

## 5. SECURITY BACKLOG — top priority (`SECURITY_BACKLOG.md`)

CMMC L2 / NIST 800-171 / OWASP re-audit (2026-07-05). **Prior hardening holds — no regressions**
(26/26 `dara_*` tables RLS, `withTenant` everywhere, Stripe webhook verified, CUI encrypted, admin gating
fail-closed, prompt-injection fencing, no LLM tool-calling). Re-audit findings are now **unified into the
DARA-xxx register as `DARA-021..045`** (was `SEC-01..23`) — in `security-content.ts` (admin-gated
`/app/security`) + the untracked `SECURITY_BACKLOG.md` (file:line evidence; don't commit while open).

- **Fixed:** DARA-024 (annotated egress), DARA-026 (isActive fail-closed), DARA-027 (sol-delete removeStored),
  DARA-028 (CSV escaping), DARA-030 (export/re-run audit), DARA-034 (cron fail-closed), **DARA-025 (BOLA sweep,
  2026-07-07)**, **DARA-046 (password reset, 2026-07-07)**.
- **In progress:** DARA-031 (MFA/2FA — opt-in shipped; **tenant-wide enforcement** is the remaining step).
- **P1 open:** DARA-021 **no rate limiting / WAF** (SC-5). DARA-022 **`next@14.2.35` HIGH advisories** (SSRF,
  middleware bypass) → 14→15 migration. DARA-023 **CI gates don't block deploys** (branch protection + CI-gated deploy).
- **P2 open:** DARA-029 crypto key-rotation. DARA-032 decompression-bomb guard. DARA-033 CSP nonce.
- **P3 open:** DARA-035 CI RLS-drift + isolation test · DARA-036 SHA-pin Actions · DARA-037 scan SBOM ·
  DARA-038 kill latent `dangerouslySetInnerHTML` · DARA-039 generic client errors · DARA-040 password policy ·
  DARA-041 audit retention · DARA-042 persona-injection residual · DARA-043 tenant right-to-delete ·
  DARA-044 company doc retention/archive limits · **DARA-045 (Moderate) invite email — see §8**.
- **Suggested next:** DARA-021 (rate limiting/WAF), DARA-029 (key rotation) on code. **Operator:** DARA-023
  (branch protection), DARA-022 (Next 15), DARA-031/040 (enforce MFA / password policy). _(DARA-025 BOLA +
  DARA-046 password reset both fixed 2026-07-07; DARA-045 invites work end-to-end — see §2.0/§8.)_

---

## 6. Fast restart

```bash
git status                       # clean main except untracked SECURITY_BACKLOG.md + tsconfig.tsbuildinfo; HEAD 0709595 (== last deployed, pushed)
git log --oneline -14            # 0709595 scan-integrity guards + detail modal · e373498 HRLR graph · 2c9a9b6 whole-doc shred · bc9e1e9 PDF line structure
pnpm install
pnpm exec tsc --noEmit
pnpm build                       # must pass; recent: /auth/confirm interstitial (GET renders, POST verifies)
# Deploy (prod = main, MANUAL): git push origin main && vercel deploy --prod --yes ; confirm via MCP list_deployments
# Schema first: pnpm prisma migrate deploy (targets prod via .env.local) BEFORE the code deploy
# Diagnose prod: Vercel MCP get_runtime_errors / get_runtime_logs
#   (projectId prj_I6CLDhGJlbjro2Mc67i1AyyHpciP, teamId team_hluvXIDuWYVTRTyXnqxTbfWg)
```

## 7. Key files

- **Shred scan-integrity guards + detail modal (2026-07-11, §0):** detectors + graph types in
  `utils/dara/hrlr/resolve.ts` (`detectCoverageGaps`/`detectFragments`/`scanSourceMarkers`/`normalizeMarker`,
  new optional `sourceText?` param) + `utils/dara/hrlr/types.ts` (`CoverageGap`, `RequirementGraph.coverageGaps`,
  optional `fragmentStatus/Reason/MergeCandidate` on `RequirementNode`); prompt rules in
  `utils/dara/hrlr/prompt.ts` (`SOLICITATION_GUIDANCE` → `EXTRACTION COMPLETENESS RULES`); surfacing in
  `utils/dara/hrlr/matrix.ts` (`renderMatrix` summary line), `utils/dara/hrlr/run.ts` (log), and
  `utils/dara/requirements.ts` (`ShredSummary.coverageGaps`, passes `solText` to `resolveGraph`, persists
  fragment fields in the `hrlr` JSONB). Modal: `components/dara/RequirementDetail.tsx` (repurposed from dead) +
  `components/dara/ComplianceMatrix.tsx` (name → `<RequirementDetail>`); data wired in
  `app/app/solicitations/[id]/page.tsx` `matrixRows` (+ `documentId→filename` map). No migration.
- **AI cost + usage ledger (2026-07-08, §0):** ledger + report `utils/dara/usage.ts` (`logUsage`, `getUsageReport`,
  `run_id`); pricing `utils/dara/pricing.ts` (`getPricingMap`/`costOf`/`refreshPricing`/`listPricing`/
  `setPriceOverride`); run context `utils/dara/run-context.ts` (`withRunContext`/`currentRunId`); weekly cron
  `app/api/cron/pricing/route.ts` + `vercel.json`; admin UI `app/app/admin/usage/page.tsx` +
  `app/app/admin/ModelPricing.tsx` + `app/app/admin/pricing-actions.ts`; worker wiring
  `utils/dara/passes.ts:processReviewJobs`; Direct-review logging `utils/dara/direct-review.ts`. Migration
  `prisma/migrations/20260708200000_ai_pricing_and_run_id` + RLS `prisma/security/2026-07-08_ai_model_price_rls.sql`.
  Schema: `AiUsageLog.runId`, new `AiModelPrice`. Memory: `ai-usage-cost.md`.
- **Admin console shell (2026-07-08, §0):** `components/layout/PlatformAdminSidebar.tsx` (all admin nav),
  `app/app/admin/layout.tsx` (guard+wrapper only), `app/app/admin/page.tsx` (dashboard + gating/accounts/users/
  admins sections + `killJob`), sub-pages `app/app/admin/{jobs,usage,ai}/page.tsx`. (`AdminNav.tsx` deleted.)
- **Account self-service (2.0):** `app/app/account/profile/{page,ProfilePanel,PasswordPanel,SignInMethodsPanel,actions}.tsx|ts`;
  avatar storage `utils/dara/avatar.ts` (public `dara-avatars` bucket) + `scripts/create-avatars-bucket.mjs`;
  shared `components/dara/Avatar.tsx`; `dara_users.avatar_url` migration `20260707000000_user_avatar`.
- **Dept editor on the list (2.0):** `components/dara/DepartmentEditor.tsx` + `setDepartmentsAction` in
  `app/app/solicitations/page.tsx` (gate `canManageDepartments`, `utils/dara/sol-access.ts`).
- **Email templates (2.0):** `supabase/templates/*.html` (12) + `README.md` (dashboard slot map); all link
  templates target `/auth/confirm` token_hash. Sidebar avatar/Profile link in `components/layout/Sidebar.tsx`.
- **2FA (DARA-031):** `app/api/auth/2fa/{setup,verify,challenge,disable}/route.ts`, `utils/dara/mfa.ts`
  (bcrypt backup codes), `utils/dara/mfa-cookie.ts` (Edge-safe HMAC marker), `app/app/account/security/*`,
  `app/auth/2fa-challenge/*`, `middleware.ts` (AAL2 gate), onboarding step `app/onboarding/OnboardingTwoFactor.tsx`.
- **Legal/TOS:** `public/legal/*.docx` + `scripts/gen-legal.mjs` → `utils/dara/legal-content.ts`;
  `components/dara/LegalDocument.tsx`; `app/onboarding/OnboardingAgreement.tsx`; `app/app/account/legal/*`;
  `acceptLegal()` in `app/onboarding/actions.ts`; `dara_users.tos_*`.
- **Auth email links:** `app/auth/callback/route.ts` (PKCE), `app/auth/confirm/route.ts` (token_hash),
  shared `utils/dara/auth-finalize.ts`; `supabase/templates/invite.html`; invite send in `utils/dara/teams.ts`.
- **Invites:** `resendInvitation`/`revokeInvitation`/`inviteUser` in `app/app/team/actions.ts`, UI `TeamView.tsx`.
- **Security register:** `utils/dara/security-content.ts` (renders `/app/security` + `/plan`), `SECURITY_BACKLOG.md`
  (untracked), `utils/dara/audit.ts`, `utils/prisma.ts` (`withTenant`), `utils/dara/provision.ts` (getDaraUser/findDaraUserRaw).
- **Chrome:** `components/layout/ChromeGate.tsx` (bares /app, /signin, /auth, /onboarding, /welcome).

---

## 8. DARA-045 — team invites now WORK (link side closed 2026-07-06 night)

**Resolved for the normal flow.** A test invite delivers and lands the invitee on `/welcome` signed in.
Two things closed it this session:

1. **Delivery** — operator configured **Resend Custom SMTP** in Supabase, so the built-in "email rate limit
   exceeded" cap no longer applies.
2. **The link** — the earlier dead link was Supabase's *default implicit-flow* template dumping the session in
   the URL `#fragment` on `/signin/...`, which no server route can read. Fixed by **Option A config**: Site URL
   = bare `https://dara.crucibleinsight.com`, redirect allowlist `…/**`, and the branded token_hash "Invite
   user" template (`supabase/templates/invite.html`) pasted into the dashboard. Links now hit `/auth/confirm`
   (`verifyOtp` on `token_hash`) → provision → onboarding/welcome.

**Residual (minor, optional):** `inviteUserByEmail` still errors "A user with this email address has already
been registered" when re-inviting an address that a prior invite already registered. The invitation ROW is
source-of-truth, so that person can just sign in. If you want clean **resend-to-existing**, the code-owned path
is `admin.generateLink` (`type=invite` for new / `type=magiclink` for existing) sent via Resend — needs
`RESEND_API_KEY` + a verified `crucibleinsight.com` from-domain. Not built (not needed for the normal flow).
Remember to **paste the other 11 branded templates** too (§2.0) so all auth emails match.
```

---

## 9. DARA-046 — password reset is broken (NEW 2026-07-07, OPEN)

**Symptom (user-reported):** the reset-password email link lands on the plain sign-in screen, not the
set-a-new-password page. Example link:
`https://dara.crucibleinsight.com/auth/confirm?token_hash=pkce_254b687c…&type=recovery&next=/app/account/profile`

**Root cause:** `requestPasswordUpdate` (`utils/auth-helpers/server.ts`) calls
`supabase.auth.resetPasswordForEmail` on the **PKCE** SSR client, so the built-in recovery email's
`{{ .TokenHash }}` (`supabase/templates/recovery.html`) renders as a **PKCE code** (`pkce_…`). The template
points at `/auth/confirm?token_hash=pkce_…&type=recovery`, and `/auth/confirm` calls
`verifyOtp({type, token_hash})` — but a `pkce_` token is **not** a verifiable OTP hash; it needs
`exchangeCodeForSession` + the code-verifier cookie from the originating browser. So `verifyOtp` fails and the
route redirects to `/signin?error=auth_link_invalid`. Opening from Outlook SafeLinks / a different device
removes the verifier entirely. **Net: nobody can reset their password.** (This is the same PKCE-vs-token_hash
class that bit invites — DARA-045 — but the recovery path was never switched to a non-PKCE token.)

**FIXED 2026-07-07 (option 2).** `requestPasswordUpdate` (`utils/auth-helpers/server.ts`) now fires
`resetPasswordForEmail` from a **supabase-js client configured `flowType:'implicit'`** (anon key,
`persistSession:false`, `autoRefreshToken:false`) instead of the default PKCE SSR client, so
`{{ .TokenHash }}` is a plain OTP hash that `/auth/confirm`'s `verifyOtp` validates server-side, cross-device
(the exact token_hash path the invite flow already uses). Also added an early-return on invalid email (it
previously fell through and sent anyway). No new env/infra; still uses Supabase's built-in Resend-SMTP email.
`/auth/confirm` itself was already correct (verifyOtp needs no verifier).

⚠️ **Recovery links minted before this deploy stay dead** — they carry the old `pkce_` token; just request a
fresh reset. **To test:** request a reset, confirm the emailed link now shows `token_hash=` **without** the
`pkce_` prefix, and that it lands you on `/app/account/profile` signed in.

_Alternative (not taken): `admin.generateLink({type:'recovery'})` + own branded email — keep in pocket if you
later want own-domain/branded recovery mail (needs `RESEND_API_KEY` + verified domain, same infra as DARA-045)._

**Second root cause found + fixed (2026-07-07) — email-scanner prefetch burned the token.** After the
implicit-token fix, prod logs still showed reset failing: a `HEAD /auth/confirm` (Outlook Safe Links /
Defender scanner) hit the link seconds before the user's `GET` and `verifyOtp` succeeded on that automated
request — consuming the single-use token — so the user's click got "Email link is invalid or has expired".
**Fix:** `app/auth/confirm/route.ts` is now **GET/HEAD = render a branded interstitial (NO verify); POST =
verifyOtp → finalizeSignIn (303)**. Scanners don't submit the form, so they can't burn the token; the user
clicks "Continue" to verify. Verified locally (GET/HEAD → 200 interstitial, no Supabase call; POST → verify →
redirect). This hardening covers ALL token_hash email links (invite/signup/recovery/email-change).

**Forced password reset before app access (2026-07-07).** A recovery verify now sets a short-lived httpOnly
marker cookie (`dara-pw-reset`, `utils/dara/pw-reset.ts`) and lands the user on **`/signin/update_password`**
instead of the app (ignoring the email's `next`). The **middleware routes every `/app` request back to that
screen until `updatePassword()` clears the marker**, so the reset can't be skipped by navigating in.
`verifyOtp` necessarily creates a session (it's what authorizes `updateUser({password})`), so this
marker-gate — not "no session" — is how the reset is forced. Verified locally: `/app` + marker → 307 →
`/signin/update_password`; without marker → normal `/signin`. **UpdatePassword screen restyled (2026-07-07):**
inputs now use the branded `bg-surf2`/`border-line`/`focus:border-navy` style (matching PasswordSignIn) instead
of the old `bg-zinc-800`, and each field has a **focus-gated reveal (eye) button** — it only toggles plain-text
while the field is focused; on blur the value re-masks and the button goes inactive (`components/ui/AuthForms/UpdatePassword.tsx`).

**Confirm-signup FIXED too (same PKCE root cause, 2026-07-07):** email confirmation IS enabled;
`confirmation.html` links to `/auth/confirm?token_hash=…&type=signup`, and `signUp` ran on the PKCE SSR
client → `pkce_` token → same failure. Both `resetPasswordForEmail` and `signUp` now use a shared
**`newImplicitAuthClient()`** helper (implicit flow, anon key, no session persistence — correct because
confirm-on means signUp returns no immediate session). Test: register a new account, confirm the email link
shows `token_hash=` without `pkce_`, and that it lands signed in → onboarding.

⚠️ **Still on the PKCE SSR client (same latent defect if enabled + token_hash templates):** magic-link
(`signInWithEmail`) and email-change (`updateEmail`). One-line fix each — swap `createClient()` →
`newImplicitAuthClient()` — but not exercised/changed this session. Do it if/when those flows are used.
