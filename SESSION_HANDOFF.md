# DARA — Session Handoff

_Prepared: 2026-07-03 · HEAD `980cc13` · branch `main` (clean, deployed) · for: next session_

Start-here-tomorrow doc. Authoritative status: `BUILD_STATUS.md` (§2 decisions, §3 completed,
§4 gaps, §7 session log — the 2026-07-03 entry covers this session in full). The MVP-launch plan:
`DARA_BUILD_PLAN.md` + the sequenced `DARA_CC_PROMPT_CHAIN.md`. Fuller architecture:
`CONTEXT_HANDOFF.md`. Security: `/app/security`. Agent memory: `multi-pass-review.md`,
`color-team-reframing.md`.

---

## 1. Where we are

- **Branch `main`, clean, HEAD `980cc13`. All deployed to prod + pushed.**
- **We are executing `DARA_CC_PROMPT_CHAIN.md`** — an 11-prompt MVP-launch hardening pass.
  - **Prompt 1 (read-only audit): DONE.** Codebase matches the build plan; the one real gap is
    the **Enterprise plan still creating a Stripe Checkout Session** (Task 8 — fix in Prompt 9).
    The CRON_SECRET guard is already present. Docs page doesn't exist yet (Prompt 7 creates it).
  - **Prompt 2 (trial fencing): DONE + extended into an entitlements/gating system** (see §2).
  - **Prompts 3–11: remaining.**
- **This session** was mostly an unplanned run of **prod bug-fixes** on the multi-pass/matrix
  flow (7 deploys) that surfaced while exercising it, capped by Prompt 2. The headline fix:
  the compliance check **never graded anything** because the batch parser (`mapBatchItem`)
  rejected every `"#<id>"` the model returned — found by running a real batch against prod data.
- **Prod:** https://dara.crucibleinsight.com · deploy is manual (`vercel deploy --prod --yes`
  after `migrate deploy` if schema changed, then `git push`). Auto-deploy still off.
- **User constraint:** credential rotation (Task 0) is **deferred to public-release time**, so we
  run Prompts 3–9 as dev sessions and **hold before the Prompt 10 deploy/operator boundary**.

### Watch-outs (don't trip on these)

- **⚠️ Entitlements/gating is DEPLOYED but INERT.** The admin can set trial limits + feature
  flags (amendments/personas/team) in `/app/admin` → **Gating**, but **nothing enforces them
  yet** — that's Prompt 3. Don't assume a set flag blocks anything until you wire it.
- **All long AI actions are now ASYNC** (JobQueue + `/api/cron/passes` cron worker): review
  passes, compliance check, shred, amendment reconcile. Pattern: an `enqueueX` + an
  `isXActive`/`activeXIds` poll flag + a client control that polls `router.refresh()`. Orphaned
  jobs (function killed mid-run) are reaped after 6 min by `reapOrphanedJobs()`. **No synchronous
  AI requests remain in the solicitation workspace** — don't reintroduce one.
- **Batch id parsing:** `mapBatchItem` now tolerates `"#1022"` / `1022`. The prompt intentionally
  lists requirements as `#<id>`; keep the parser tolerant, don't "fix" the prompt.
- **`AddSection` modals:** use `<CloseModalOnComplete/>` (a `useFormStatus` child) to close on
  action completion. Do NOT go back to a capture-phase submit listener — it swallows the submit.
- **`after()` unavailable in Next 14.2.35** — worker kicks via `triggerWorker()` fire-and-forget
  fetch; the every-minute cron is the backstop. Hard-refresh after every deploy (deploy skew).
- **Schema deploy order:** `pnpm prisma migrate deploy` (owner/DIRECT_URL) → apply new RLS (only
  for NEW tables) → `vercel deploy` → `git push`. Column-only adds need only `migrate deploy`.
- **Local `withTenant` reads P2028 from this machine** (interactive-transaction latency to
  Supabase). Not a prod issue — verify DB things via `prismaAdmin` in a throwaway tsx script, or
  in prod. (That's how the compliance bug was diagnosed.)

---

## 2. The entitlements/gating system (built this session — read before Prompt 3)

**Engine: `utils/dara/trial.ts`.** Resolution chain: **code defaults → platform default →
per-company override**.
- `requireTrialCapacity(companyId, resource)` — `resource ∈ {solicitation, review_run, seat}`,
  default limits 2/3/2. No-op on paid plans; throws `TrialLimitError` when over, or (used=limit=0)
  when the trial window has expired.
- `requireFeature(companyId, feature)` — `feature ∈ {amendments, personas, team}`. Applies to ALL
  plans; throws `FeatureDisabledError` when off. Features default ON.
- Platform defaults live in `PlatformSetting.defaultEntitlements`; per-company overrides in
  `Company.entitlements` (both JSON). `resolveEntitlements(raw, base)` merges; `getPlatformDefault
  Entitlements()` / `setPlatformDefaultEntitlements()` for the singleton.
- Admin UI in `app/app/admin/page.tsx`: `saveDefaultGating` (platform), `updateCompanyEntitlements`
  / `clearCompanyEntitlements` (per-company, opt-in — NOT written on a plain account save, so
  platform-default changes propagate). Sidebar item added in `PlatformAdminSidebar.tsx`.

**★ Prompt 3 = wire the enforcement (currently inert):**
1. `requireTrialCapacity` into `createSolicitation` (`app/app/solicitations/new/page.tsx`),
   `enqueueReviewRun` (`utils/dara/passes.ts`), `inviteUser` (`app/app/team/actions.ts`).
   Placement gotchas from the Prompt 1 audit: call it **before** the `withTenant` tx in
   createSolicitation (it opens its own); seat check only in the **new-invitation** branch of
   inviteUser (not when re-assigning an existing member). Catch `TrialLimitError` → redirect
   `/app/billing?limit=<resource>` (or return the form error for invites).
2. Dashboard trial status bar (`app/app/dashboard/page.tsx`) — days left + used/limit per the plan.
3. `requireFeature` at feature entry points: **amendments** (Amendments panel + `enqueueReconcile`
   / upload), **personas** (`/app/personas` + persona actions), **team** (`/app/team` + invite).
   Decide UX for a fenced feature (hide the nav/section + block the action).
4. Follow the build plan's Prompt 3 (Task 1.2–1.4, 1.6) for the trial parts; the feature-gate
   parts are the extension — mirror the same catch/redirect or hide pattern.

---

## 3. Queue for next session (suggested order)

1. **★ Prompt 3 — enforcement wiring** (above). Ends at `pnpm build` clean; commit + push
   (deploy is fine here — no operator prereqs — but you may batch with Prompt 4).
2. **Prompt 4** — onboarding wizard 6 → 3 steps (`profile`, `ai`, `done`); plain-language AI copy.
3. **Prompt 5** — solicitation workspace 3-tab nav (Compliance/Review/Export) + sidebar simplify.
4. **Prompts 6–8** — navy/gold/Inter light reskin (tokens → shell/auth → dashboard/solicitation →
   remaining pages). The big one; page-by-page. Ref: `…/scratchpad/DARA_design.html`.
5. **Prompt 9** — CUI modal copy, image-only-PDF failure message, in-app docs page, **Enterprise
   Stripe guard** (the real Prompt-1 gap: `billing/page.tsx` renders a Checkout button for
   `enterprise` via `PLAN_CATALOG.enterprise` — make it a contact-us link).
6. **Prompts 10–11** — CRON_SECRET guard (already present, confirm) + quality gates + launch.
   **Hold here** until the user is ready for release (credential rotation, operator checklist).

### Operator actions (you) — unchanged, still open
- Platform model → **Sonnet** (biggest quality lever across all AI passes).
- Optional `CRON_SECRET` in Vercel (all envs) to lock `/api/cron/passes`.
- Branch protection on `main` (BUILD_STATUS #13). Supabase Auth Site URL + Confirm-email (#1).

---

## 4. Fast restart commands
```bash
git status                 # expect clean main, HEAD 980cc13
git log --oneline -12
pnpm install               # if needed
pnpm exec tsc --noEmit
pnpm build
# New dara_* table/column? DB BEFORE deploy:
#   pnpm prisma migrate deploy
#   npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql   # only if new table
# deploy: vercel deploy --prod --yes  then  git push  then HARD-REFRESH (Ctrl+Shift+R)
```
