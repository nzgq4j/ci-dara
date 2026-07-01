# DARA — Session Handoff

_Prepared: 2026-07-01 (end of the multi-pass session) · for: next session_

Start-here-tomorrow doc. Authoritative status: `BUILD_STATUS.md` (§2 decisions, §3 completed,
§4 gaps, §7 session log). Fuller architecture: `CONTEXT_HANDOFF.md`. Open security findings:
`/app/security` + `utils/dara/security-content.ts`. Agent memory: `multi-pass-review.md`,
`color-team-reframing.md`.

---

## 1. Where we are

- **Branch:** `main`, clean. HEAD `d55ccdf`. Everything below is deployed to prod and pushed.
- **This session delivered the imported `DARA.dc.html` multi-pass design** (screens 1/3/4:
  dashboard, AI review panel, compliance matrix) plus requirement disposition and two prod
  bug fixes. In order (most recent first):
  - `d55ccdf` — **multi-pass shred + amendment coverage passes** (recall). `shredRequirements`
    runs ≤2 coverage passes hunting missed requirements; `reconcileAmendment` runs 1 coverage
    pass. Completes the original "multi-pass for matrix + amendment + evaluations" ask.
  - `2070c6c` — **dashboard** P1/P2/P3 pass badges (aggregated per solicitation) + Avg Score stat.
  - `20d05b6` — compliance **"Sync from AI review"** — folds latest Pass-1 findings into the
    matrix (no LLM), idempotent `AI:` notes block + status nudge.
  - `4b0d4c1` — matrix **Notes** column + "Response loc." relabel + **CSV/Word export**.
  - `da370ed` — **★ multi-pass AI review**: each color-team review runs Pass 1 Compliance &
    Format → Pass 2 Technical Responsiveness → Pass 3 Risk & Competitive, **async** (JobQueue +
    Vercel cron worker), scored, severity-ranked findings. `ReviewPassPanel` polls live.
  - `5c1bf8b` — create-review client crash + modal-not-closing fix.
  - `f20b77e` — matrix modal centering (portal to body vs `.fade` transform trap).
  - `c895da8` — requirement **disposition** (scored/compliance/administrative) auto-classified
    by the shred; shred excludes non-requirements (scoring methodology/boilerplate);
    `RequirementVersion` `@map` drift fixed.
- **Verified in prod by the user:** a full multi-pass review run (passes go
  queued→running→complete with scores + findings).
- **Prod:** https://dara.crucibleinsight.com · deploy is manual (`vercel deploy --prod --yes`
  after push; GitHub→Vercel auto-deploy still not firing).
- **Security posture:** no audit findings open (DARA-007 risk-accepted). SSP at
  `/app/security/plan`.

### Watch-outs (don't trip on these)

- **⭐ Reviews are now MULTI-PASS (3 fixed lenses), layered onto color teams** (`da370ed`).
  Run enqueues 3 passes (async); `ReviewPassPanel` shows them. The **old per-persona holistic
  `runEvaluation`/`Result` path is preserved but secondary** (collapsed "Earlier per-reviewer
  findings"). Do not wire the Run button back to `runEvaluation`.
- **`after()` is unavailable in Next 14.2.35.** Worker kicks via fire-and-forget `fetch` to
  `/api/cron/passes` (`triggerWorker`); **cron every minute** (`vercel.json`) is the backstop.
  If a run seems stuck, the cron picks it up within ~60s. `CRON_SECRET` optional (route allows
  if unset — set it in Vercel to lock the worker route down).
- **Vercel deploy-skew** — hard-refresh (Ctrl+Shift+R) after every deploy before re-testing.
- **`AddSection` closes on submit** (capture-phase `submit` listener) and `createReview`
  **revalidates instead of redirecting** — this fixed a recurring client-side exception +
  modal-stay-open. Keep both; the combo (open portal modal + server-action re-render) is what
  crashed.
- **Requirement `disposition`** governs the compliance sweep (`disposition=compliance` only;
  administrative → N/A, skipped; scored ⇔ isScored). The shred auto-classifies + excludes the
  scoring methodology / boilerplate / Gov responsibilities.
- **Multi-pass adds LLM calls** (3 review passes; ≤2 shred coverage passes; 1 amendment coverage
  pass) — all best-effort/bounded, but **set the platform model to Sonnet** for quality (see §2).
- **Schema deploy order** — `migrate deploy` → apply new RLS (only for new tables) → `vercel
  deploy` → push. New `dara_*` tables (`dara_review_passes`, `dara_findings`) are fail-closed
  until granted; column adds (disposition, notes) need only `migrate deploy`.

---

## 2. Queue for next session (suggested order)

### ★ Top of queue — Full navy/gold reskin (design's visual system)
The imported design is a full reskin: navy `#1B2A4A` / gold `#B8952A` / Inter, **light** theme,
new top-nav — vs the current IBM Plex **dark** theme. Explicitly deferred as its own effort.
Approach deliberately: **adopt the token system first** (extend `tailwind.config.js` /
`styles/main.css` with the navy/gold light palette), then convert **page-by-page** (shell/nav →
dashboard → solicitation workspace → matrix → settings/admin). Do NOT do it as one giant diff.
Reference HTML: `…/scratchpad/DARA_design.html`.

### A. Operator actions — browser/CLI (you)
1. **Platform model → Sonnet** (Application Admin → Platform AI). Now the biggest quality lever:
   the 3 review passes + shred/amendment coverage passes all use it.
2. **Optional `CRON_SECRET`** in Vercel (all envs) → locks `/api/cron/passes`. Requires redeploy.
3. **Branch protection on `main`** (BUILD_STATUS #13) — the only thing keeping DARA-015 from
   "enforced".
4. **Supabase Auth** (BUILD_STATUS #1): Site URL + Confirm-email ON.

### B. Verify in prod
- A fresh **matrix generate** → watch the coverage passes add requirements (2-3 rounds).
- An **amendment reconcile** against a populated matrix (coverage pass merges extra changes).
- The **dashboard** AI-pass badges + Avg Score render.

### C. Feature backlog
- Per-company **audit-log viewer** (company-admin, on the Team page).
- **AI codebase security-audit** (app-admin, platform key → findings register).
- Migrate the legacy shred/compliance-sweep to the **JobQueue + cron** path too (it exists and
  works now) if they start hitting the synchronous function budget at scale.
- Billing polish (`starter`→"Base"; handle `subscription.paused`).

---

## 3. Offline / non-code follow-ups
- **ZDR agreements** on platform LLM keys (Anthropic DPA+ZDR primary; OpenAI ZDR on approval;
  Google paid/Vertex ZDR). On signing, update the DARA-007 CUI notice copy. Tracked in
  `prisma/security/DARA-007-data-boundary.md`.

---

## 4. Fast restart commands
```bash
git status                 # expect clean main, HEAD d55ccdf
git log --oneline -10
pnpm install               # if needed
pnpm exec tsc --noEmit
pnpm build
# New dara_* table/column? DB BEFORE deploy:
#   pnpm prisma migrate deploy
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql   # only if new table
# deploy: vercel deploy --prod --yes  then  git push  then HARD-REFRESH
```
