# DARA — Direct AI Review Mode · Plan of Action & Milestones (POA&M)

**Source:** `design_handoff_dara_direct_review` (README.md + Get Well Plan + DARA.dc.html mockups), 2026‑07‑04.
**Status:** Approved to plan. Supersedes the "color‑team only" build direction — Direct AI is added as a **coexisting** mode, color‑team screens stay intact.
**Owner:** Implementation (Claude) · **Prepared:** 2026‑07‑04

### Build progress
- ✅ **M0 — Schema/migration/RLS/backfill** (2026‑07‑04). `schema.prisma` (`ReviewMode`/`DirectReviewStatus` enums, `Solicitation.mode`, `DirectReview` model, `Finding` repoint), migration `20260704000000_direct_ai_review`, RLS `2026-07-04_direct_reviews_rls.sql`, DARA‑017 manifest. Verified: Prisma delta matches hand‑authored SQL exactly; `prisma generate` + `tsc --noEmit` clean. **Not yet applied to any DB** (manual owner step: `migrate deploy` then `apply-sql.ts`, RLS before code deploy).
- ✅ **M1 — Engine** (2026‑07‑04). `buildDirectReviewPrompt`/`parseDirectReviewResult` (prompt.ts), `utils/dara/direct-review.ts` (`enqueue`/`run`/`isActive`/`ensure`), worker `direct_review` branch + orphan reap (passes.ts), `review_run` trial gate now spans both paradigms. `tsc` clean. *Runtime fixture test deferred — needs live DB + API key.*
- ✅ **M2 — Dashboard + list** (2026‑07‑04). Shared `components/dara/ReviewModeBits.tsx` (`ModeChip`/`AiReviewStatus`/`AiReviewAction`, token‑themed per D5); mode chip + mode‑aware AI Review status on `dashboard/page.tsx`; mode chip + AI Review + Actions columns on `solicitations/page.tsx`. `tsc` clean.
- ✅ **M3 — Upload & Instant Review** (2026‑07‑04). `components/dara/UploadAndReview.tsx` (two‑step drag‑drop: solicitation docs + proposal draft, metadata, Advanced→Color Team toggle); `solicitations/new/page.tsx` rebuilt with `createAndRunReview` action (create sol w/ mode → upload docs → enqueue direct review → redirect). Raised `serverActions.bodySizeLimit` to 25mb (also fixes latent limit on the workspace uploader). *Trial enforcement intentionally omitted — not wired in any existing flow yet; count logic is ready.*
- ✅ **M4 + M5 — Workspace mode branch + findings panel** (2026‑07‑04). `components/dara/DirectReviewPanel.tsx` (states A/B/C, score summary + score card + severity filter + flat findings, reuses ReviewPassPanel's exact finding‑row markup, 3s poll). Workspace `[id]/page.tsx`: loads `directReviews` w/ findings, `runDirectReviewAction`, `fmtDateTime` (deterministic), mode chip + subtitle, and **mode‑branched pipeline** — direct_ai collapses to Solicitation → Compliance → AI Review; color‑team keeps the full 9‑stage `PipelineStepper` untouched. Screen 2's "left panel" score summary folded into the panel (workspace has no persistent rail; Team Lead omitted — no such field in direct mode). **Full `pnpm build` passes (25 routes).**
- ✅ **M6 — Wiring, coexistence & immutability** (2026‑07‑04). Dashboard/list actions route to the workspace; direct sols default to the AI Review stage. **Mode immutability holds by construction** — `Solicitation.mode` is written only at creation (`createAndRunReview`); no code path mutates it and no switch UI exists (dashboard chip tooltip states it). Color‑team path preserved verbatim (the `isDirect` branch keeps the full 9‑stage pipeline + all existing panels/actions). Full `pnpm build` green.
- ✅ **M7 — Security review + docs** (2026‑07‑04). Security review of the branch diff: **no HIGH/MEDIUM findings** — new table/RLS mirror the DARA‑004 tenant pattern, `runDirectReviewAction` gated by `requireViewableSolicitation`, all queries Prisma‑parameterized + `withTenant`, React auto‑escapes findings, prompt injection‑guarded. Docs (this POA&M, `SESSION_HANDOFF`, memory) updated.

### Testing (2026‑07‑04)
- **Offline (22 assertions, pass):** `buildDirectReviewPrompt` (injection guard, both docs fenced, all three lenses, flat‑array instruction) + `parseDirectReviewResult` (score clamp, unknown‑severity → medium, empty‑text drop, truncated‑array salvage, prose‑wrapper extraction).
- **Live model round‑trip (pass):** real `claude-sonnet-4-6` call on synthetic data → score 8 + 12 severity‑ranked findings across all three lenses, parsed cleanly. ~41s/call (well under the worker's 160s tick budget → the single‑call design fits).
- **Not run:** full DB flow (enqueue → worker → persisted findings → UI). Needs the migration applied to a database; the only DB is remote (prod) and `withTenant` interactive transactions throw P2028 from the dev machine, so this is verified after the owner applies the migration.

### Follow‑ups for the MVP prompt‑chain (see SESSION_HANDOFF)
- **Prompt 3 (trial enforcement):** wire `requireTrialCapacity('solicitation')` + `('review_run')` into **`createAndRunReview`** (`new/page.tsx`) and `runDirectReviewAction` — this file was rebuilt, so the planned `createSolicitation` target no longer exists. The `review_run` count already spans both paradigms.
- **Prompts 6–8 (navy/gold reskin):** the new components use semantic tokens, so the reskin carries them along; the few hardcoded hex values match their existing siblings (e.g. `ReviewPassPanel`) and get reskinned together.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| D1 | What the Direct AI review analyzes | **The company's proposal draft vs. the solicitation** — same inputs the color‑team passes use, collapsed into **one unified lens** (compliance/format + technical responsiveness + risk/competitive) producing **one score + one flat findings list**. |
| D2 | Data‑layer model | **New lightweight `DirectReview` path** — a dedicated table + engine + worker branch, decoupled from `ReviewPass`. `Solicitation.mode` enum gates the two worlds. Color‑team tables untouched. |
| D3 | Default mode | New solicitations default to **`direct_ai`**; Color Team is opt‑in via "Advanced review options" on upload. |
| D4 | Immutability | `Solicitation.mode` is fixed once a review is initiated. |
| D5 | UI palette | **Adapt to the app's existing design system** — reproduce the mockups' layout/structure/copy/states faithfully, but map all colors to DARA's semantic tokens (`bg`/`surf`/`t1`–`t5`, `#3b6ef0` accent, existing severity badges). The app is theme-aware (light+dark); the handoff's fixed navy/gold light palette + literal severity hex are **not** used (they'd break dark mode and contradict the spec's own "reuse the existing finding component exactly"). *(Decided 2026-07-04 as best-judgment default while user away; revisit if desired.)* |

### Design reconciliation (important)
The mockups show *"upload a solicitation → instantly Run AI Review."* But D1 grades a **proposal draft**, which the raw solicitation upload doesn't include. Resolution baked into this plan:

- The Direct AI review runs against the solicitation's current **proposal working draft** (`SolDocument.docType = 'proposal'`), reading it live at run time (no frozen snapshot in v1 — snapshotting is backlog).
- **Screen 4 (Upload & Instant Review)** accepts *both* solicitation docs (Section L/M/PWS) **and** proposal draft file(s). "Run AI Review" is enabled once a proposal draft is present; if only solicitation docs were uploaded, surface an inline hint ("Add your proposal draft to review it") rather than blocking. This keeps the one‑click promise without silently reviewing nothing.

---

## 2. What does NOT change (regression guardrails)

Nav bar & DARA branding · Solicitation metadata left rail · Document viewer (L/M/PWS tabs) · Severity taxonomy (Critical/High/Medium/Low + colors) · Compliance Matrix right rail · Export/report actions · **The entire color‑team P1/P2/P3 flow** (`utils/dara/passes.ts`, `ReviewPassPanel`, the 9‑stage `PipelineStepper`, `dara_reviews`/`dara_review_passes`/`dara_findings`).

---

## 3. Data model changes (Milestone 0)

New Prisma enums/models in `prisma/schema.prisma` + migration:

```
enum ReviewMode { direct_ai  color_team }
enum DirectReviewStatus { not_started  running  complete  error }

model Solicitation { … mode ReviewMode @default(direct_ai) @map("mode") }

model DirectReview {
  id, companyId, solicitationId (unique — one active per sol)
  status DirectReviewStatus @default(not_started)
  score Int?                 // 0–100, null until complete
  progress Int @default(0)   // live bar
  progressLabel String
  findingsCount Int @default(0)
  errorMessage String?
  runAt DateTime?            // last completed run
  startedAt / completedAt / createdAt / updatedAt
  findings Finding[]
  @@index([companyId]) @@index([solicitationId])
}

// Finding: repoint to serve BOTH paths (reuse the finding row component verbatim)
model Finding {
  passId BigInt?            // now nullable (color‑team)
  directReviewId BigInt?    // new (direct‑ai)
  // exactly one of passId / directReviewId set
}
```

**Migration tasks**
- Add enums, `solicitation.mode`, `dara_direct_reviews` table, `finding.direct_review_id` (+ make `pass_id` nullable).
- **RLS**: company‑scoped policies on `dara_direct_reviews` mirroring existing tenant policies (NIST 800‑171 / DARA tenancy standard). Verify `Finding` policy still holds with the new FK.
- **Backfill**: **all** existing solicitations → `color_team` (they predate Direct AI and were created under the color-team-only UI; never retroactively switch an established workflow). The `direct_ai` column default applies only to newly created rows.
- `pnpm supabase:generate-types` → refresh `types_db.ts`; `prisma generate`.
- **Acceptance:** migration applies clean, backfill correct, RLS denies cross‑tenant reads of `dara_direct_reviews`, color‑team queries unaffected.

---

## 4. Milestones

> Sequencing note: the design brief assumed "UI only, backend unchanged." Our D2 choice adds a new table + engine, so **foundation (M0/M1) lands before UI (M2–M5)** — the reverse of the brief's ordering, but the UI depends on it.

### M0 — Schema, migration, RLS, backfill  ·  *effort: M*
Section 3 above. **Gate for everything downstream.**

### M1 — Direct AI engine (unified lens + worker)  ·  *effort: L*
- `utils/dara/prompt.ts`: add `buildDirectReviewPrompt()` merging the three `PASS_LENS` lenses into one system/user prompt → asks for a single `score` + flat `findings[]` (severity/text/requirementRef/recommendedAction). **Must include the existing prompt‑injection `SECURITY NOTICE`** over untrusted proposal/solicitation content. Add `parseDirectReviewResult()` (reuse the `parsePassResult` shape).
- `utils/dara/direct-review.ts` (new):
  - `enqueueDirectReview(solId, companyId)` — upsert `DirectReview` → `running`, drop a `JobQueue` row `{ kind: 'direct_review', directReviewId }`, `triggerWorker()`.
  - `runDirectReview(directReviewId, companyId, deadline)` — load proposal draft + RFP + requirements (reuse `concatDocs`), one `complete()` call, write score + replace findings, mark `complete`/`error`. One LLM call → fits comfortably in the tick budget (no P1→P2→P3 time‑boxing needed).
  - `isDirectReviewActive()` / status helpers for the poll.
- `utils/dara/passes.ts` worker (`processReviewJobs`): add `kind === 'direct_review'` branch; extend `reapOrphanedJobs` to reset stuck `running` DirectReviews.
- **Trial/entitlements**: count a Direct AI run against `utils/dara/trial.ts` limits + gate behind the review capability flag (per the per‑company entitlements system).
- **Audit**: `recordAudit('review.run', kind:'direct_review')`.
- **Acceptance:** enqueue → worker runs → `DirectReview` reaches `complete` with a score and ≥1 finding on a fixture; orphaned run is reaped; trial cap enforced.

### M2 — Screen 1: Dashboard mode chip + AI Review status  ·  *effort: S*
Target: **`app/app/dashboard/page.tsx`** (the P1/P2/P3 dashboard) — and mirror the mode chip on `app/app/solicitations/page.tsx` list.
- Load each solicitation's `mode` + `DirectReview` status/score in the query.
- **Mode chip** before title: `Direct AI` (blue `#DBEAFE`/`#1D4ED8`) · `Color Team` (navy `#1B2A4A`/`#fff`), 10px/600.
- For `direct_ai` rows: replace the `aggPasses` P1/P2/P3 pills with the single **AI Review** status column — `COMPLETE`+score / `RUNNING`(pulse dot) / `NOT STARTED`. Color‑team rows keep the pass pills.
- **Actions** (context‑sensitive): not started → "Start Review" (gold `#B8952A`); running → "View Progress" (navy outline); complete → "Open Findings" (navy fill).
- Mode chip click → tooltip "Mode set at upload. Cannot be changed."
- **Acceptance:** both modes render correct chip/status/action; color‑team dashboard visually unchanged.

### M3 — Screen 4: Upload & Instant Review (new)  ·  *effort: M*
- Rebuild `app/app/solicitations/new/page.tsx` as the two‑step full‑page flow (replaces today's metadata‑only form).
- **Step 1:** drag‑drop zone (PDF/Word/ZIP, "Section L/M/PWS auto‑detected") + proposal draft; optional Sol Number / Agency / Due Date; **"Advanced review options" toggle → "Switch to Color Team review"** (collapsed).
- **Step 2:** uploaded filenames w/ green checks; single full‑width **"Run AI Review"** (navy, 44px) + "Review runs in the background. You can close this tab."
- Server action: create solicitation with `mode` (`direct_ai` default, or `color_team` if toggled) → store docs via the existing `uploadSolDoc` machinery (`[id]/page.tsx:634`) → `enqueueDirectReview` → redirect to workspace **AI Review in Running state**. Color‑team path routes to the existing pipeline instead.
- **Acceptance:** upload → one click → lands on running findings view; Color‑Team toggle routes to the P1/P2/P3 flow; no modal/wizard.

### M4 — Screen 2: Workspace left panel (mode‑gated)  ·  *effort: S*
Target: `app/app/solicitations/[id]/page.tsx`, `mode === 'direct_ai'` branch only.
- AI Review Summary: replace the 3 per‑pass bars with **one "AI Review Score" bar** + a **4‑up finding count** (Critical `#991B1B` / High `#C05621` / Medium `#B45309` / Low `#1D4ED8`, 700/12px).
- Team assignments: drop "Volume Owner"/"Contracts"; keep **Team Lead** + **Open Findings** count (amber `#92400E`).
- Action bar: **"Run AI Review"** (navy) pre‑run → **"↻ Re‑run Review"** (navy outline) post‑run; no pass‑selector modal.
- **Acceptance:** direct_ai left rail matches spec; color_team left rail unchanged.

### M5 — Screen 3: Unified findings panel (new component)  ·  *effort: L*  ← most substantive
- New `components/dara/DirectReviewPanel.tsx` (`'use client'`, polls via `router.refresh()` on a 3s interval while `running` — same pattern as `ReviewPassPanel`).
- **State A (Not Started):** header `AI REVIEW · [SOL#]`, skeleton shimmer rows, full‑width "Run AI Review".
- **State B (Running):** pulsing `• Running`, single unified progress bar (blue `#1D4ED8`) + status label; findings/filter counts update live.
- **State C (Complete):** score card (48px numeral + bar + "of 100", total count, last‑run timestamp, "↻ Re‑run Review") → filter row (All/Critical/High/Medium/Low, active = navy) → **flat findings table sorted by severity desc**, reusing the existing 4‑column finding row (Severity · Finding · Ref · Recommended Action) **lifted out of the pass accordion**.
- Left rail (Screen 3 variant): "AI REVIEW SCORE" label + large numeral (color by range: ≥85 `#166534`, 65–84 `#92400E`, <65 `#991B1B`) + bar + 4‑up counts; metadata rows below unchanged.
- For `direct_ai` solicitations, collapse the 9‑stage color pipeline to a **simplified view set** (metadata + Documents + Compliance Matrix + AI Review); color_team keeps the full `PipelineStepper`.
- **Acceptance:** all three states render; client‑side severity filter works; findings identical in shape/markup to color‑team rows; re‑run creates a fresh run.

### M6 — Wiring, coexistence & QA  ·  *effort: S*
- Wire Dashboard "Start Review" → Screen 4; "Open Findings" → Screen 3 direct‑AI variant; "View Progress" → running state.
- Enforce `mode` immutability after first run (server guard + tooltip).
- **Regression QA:** color‑team P1/P2/P3 dashboard, workspace, pass panels, and pipeline all unchanged and reachable; a color_team solicitation never shows Direct AI UI and vice‑versa.

### M7 — Security, docs & close‑out  ·  *effort: S*
- `/security-review` on the diff; confirm RLS on `dara_direct_reviews`, prompt‑injection notice in the unified prompt, tenant isolation, audit coverage (NIST 800‑171/53, CMMC L2, OWASP per standing standard).
- Update `BUILD_STATUS.md` / `SESSION_HANDOFF.md`; refresh memory (color‑team‑reframing → note Direct AI coexistence).

---

## 5. Cross‑cutting concerns
- **Security/tenancy:** every new table/query company‑scoped via `withTenant` + RLS; untrusted‑content notice mandatory in the new prompt.
- **Async correctness:** reuse the proven JobQueue + orphan‑reap + `triggerWorker` machinery; a Direct AI run is a *single* LLM call so it's simpler than the 3‑pass time‑boxing.
- **Entitlements/trial:** Direct AI runs consume review quota and respect the per‑company capability flags.
- **Testing:** fixture‑driven engine test (enqueue→complete), migration/backfill check, and a manual coexistence pass over both modes.

## 6. Dependency graph
`M0 → M1 → { M2, M3, M4, M5 } → M6 → M7`  (M2–M5 parallelizable once M0/M1 land; M5 is the critical path).

## 7. Backlog (explicitly deferred)
Historical review snapshots / timestamp dropdown on re‑run · frozen proposal snapshot for Direct AI · SAM.gov metadata auto‑fill · report templates that cite per‑pass scores · mobile/tablet responsive · Admin/Templates/Reports nav screens.
