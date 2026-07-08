# Admin Redesign — Prompt 4 Handoff

**Date:** 2026-07-08
**Status:** ⛔ BLOCKED at Step 1 (orientation). Did not write any code.
**Branch:** `main` @ `20a4092`

---

## TL;DR

Prompt 4 ("live jobs, AI usage ledger, AI keys + model config") assumes Prompts 1–3
of the admin redesign are already landed. **They are not in this repo.** None of the
scaffolding or data layer Prompt 4 depends on exists on `main`, in the
`velvety-tinkering-castle` worktree, or on any local branch checked.

The admin console is still the **original monolithic** `app/app/admin/page.tsx`
(~32 KB, single page). It was never split into sub-pages.

**Nothing was written.** This file documents the gap so the work can resume correctly.

---

## What Prompt 4 wanted to build

Three sub-pages under `app/app/admin/`:

1. `jobs/page.tsx` — live JobQueue (pending/running) + last-24h history; move
   `killJob`/`killAllJobs` here (revalidate `/app/admin/jobs`).
2. `usage/page.tsx` — AI usage ledger from `AiUsageLog`, grouped by company+provider+model
   and by capability; `?days=N` (today/7/30) ranges; four stat cards.
3. `ai/page.tsx` — provider keys card + active-model card + **per-capability model
   overrides** table (capabilities: `shred, compliance_sweep, review_pass,
   direct_review, amendment_diff, evaluation`).
4. New server action `saveCapabilityOverride(formData)` in `ai-actions.ts`, calling
   `setCapabilityOverride()`.

---

## Inventory — verified 2026-07-08

### ✅ Exists and usable

| Item | Path | Notes |
|---|---|---|
| `PageHeader` | `components/dara/PageHeader.tsx` | props `{ eyebrow, title, subtitle, action }` |
| `ConfirmButton` | `components/dara/ConfirmButton.tsx` | props `{ message, className, children }` — submit button in a server-action form |
| Key/model actions | `app/app/admin/ai-actions.ts` | `savePlatformKeys`, `savePlatformModel` — both `revalidatePath('/app/admin')` |
| Active-model picker | `app/app/admin/PlatformAISelect.tsx` | client component |
| Platform AI view | `utils/dara/platform-ai.ts` | `getPlatformAIView()`, `getPlatformAI()`, `setPlatformKeys`, `setPlatformModel` |
| Model catalog | `utils/dara/ai-catalog.ts` | `MODEL_CATALOG`, `AI_PROVIDERS` |
| `JobQueue` model | `prisma/schema.prisma:877` | fields: `payload`, `status`, `attempts`, `maxAttempts`, `error`, `availableAt`, `startedAt`, `finishedAt`, `progress`, `progressLabel`, `company` relation |
| `killJob` / `killAllJobs` | `app/app/admin/page.tsx:217`, `:245` | currently **inside** the monolithic page; revalidate `/app/admin`. Both audit via `recordAudit`. |

### ❌ Missing — the foundation Prompt 4 assumes (from Prompts 1–3)

| Missing item | Prompt 4 uses it for | Confirmed absent |
|---|---|---|
| `app/app/admin/jobs/page.tsx` | target page (Prompt 2 placeholder) | Not tracked; not in worktree |
| `app/app/admin/usage/page.tsx` | target page (Prompt 2 placeholder) | Not tracked; not in worktree |
| `app/app/admin/ai/page.tsx` | target page (Prompt 2 placeholder) | Not tracked; not in worktree |
| `utils/dara/capability-model.ts` | `getCapabilityOverrides()`, `setCapabilityOverride()` (Prompt 1) | File does not exist anywhere |
| `AiUsageLog` Prisma table | the usage-ledger data source | **No usage-ledger table exists.** Token counts live only as `token_in`/`token_out` columns on the per-requirement `Result` model (`prisma/schema.prisma:834`). |
| `logUsage`, `AICapability` in `providers.ts` | usage logging + capability enum | `utils/dara/providers.ts` exports only `resolveCompanyAI`, `complete`, and interfaces — no capability concept, no usage logging. |

### Admin console today

`app/app/admin/page.tsx` is one monolithic server component. Relevant landmarks:
- `killJob` `:217`, `killAllJobs` `:245`
- Background-jobs section `#jobs` `:336` (reads `activeJobs`, renders rows + kill buttons)
- Platform AI section `#ai` `:414` (keys form via `savePlatformKeys`, active model via `PlatformAISelect`)

The full-detail active-job row markup (payload kind, entity id, status badge, attempts,
started-Nm-ago) already exists at `:351`–`:400` and is a good basis for the richer
`jobs/page.tsx` rows.

---

## Why this blocks Prompt 4

Prompt 4 names four data sources: `getCapabilityOverrides`, `setCapabilityOverride`,
`AiUsageLog`, and `logUsage`/`AICapability`. **Three of the four do not exist**, and none
of the three target pages exist. Executing as written would mean silently creating an
entire data layer — including a **new Prisma model + DB migration** for `AiUsageLog`,
usage-logging plumbing in `providers.ts`, and a capability-override store — which is far
beyond "build three sub-pages" and should not be guessed at.

---

## Options to resume

1. **Point to the real base.** If Prompts 1–3 were run on a different checkout / branch /
   stash / PR, apply or identify that base, then re-run Prompt 4 against it.

2. **Build the foundation first (recommended if 1–3 truly weren't done).** Scope and get
   sign-off on the missing pieces before writing:
   - `AiUsageLog` Prisma model + migration (company, provider, model, capability,
     tokenIn, tokenOut, estCost?, createdAt) — **schema migration, needs explicit
     approval**.
   - `logUsage(...)` + `AICapability` in `utils/dara/providers.ts`, wired into `complete()`
     callers so the ledger actually fills.
   - `utils/dara/capability-model.ts` with an override store (`getCapabilityOverrides`,
     `setCapabilityOverride`, resolution used by callers).
   - Split the monolithic admin page into the redesigned shell + `jobs/`, `usage/`, `ai/`
     placeholders (the Prompt 2/3 work), then do Prompt 4.

3. **Adapt Prompt 4 to what exists (reduced scope).** Build `jobs/page.tsx` (JobQueue is
   real) and `ai/page.tsx` keys+model (platform-ai is real) for real; derive `usage`
   from existing `Result.token_in/token_out` instead of a new `AiUsageLog`; **drop**
   capability overrides until the store exists. Ship a smaller, honest Prompt 4.

---

## Open questions for the operator

1. Were Prompts 1–3 ever run **in this repo**? (Checked `main`, the
   `velvety-tinkering-castle` worktree, and all local branches — nothing.)
2. Is there a branch / stash / PR / uncommitted set that is the real base for Prompt 4?
3. Usage ledger: create a dedicated `AiUsageLog` table, or derive reporting from the
   existing per-`Result` token columns?

---

## Verification commands used

```bash
git worktree list
git branch -a
git ls-files 'app/**/admin/**'
git ls-files | grep -iE "capability|usage-log|ai-usage"     # (no matches)
grep -nE "model (JobQueue|AiUsageLog)" prisma/schema.prisma  # JobQueue only
grep -rniE "logUsage|AICapability" --include=*.ts .          # (no matches)
```
