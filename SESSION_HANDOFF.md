# DARA — Session Handoff

_Prepared: 2026-06-28 (end of session) · for: next session_

This is the "start here tomorrow" doc. Authoritative status lives in
`BUILD_STATUS.md` (§5 backlog, §7 session log); open security findings live on
`/app/security` and in `utils/dara/security-content.ts`.

---

## 1. Where we are

- **Branch:** `main`, clean. Last commit `668b406` (SSP page + control-posture
  refresh) is **deployed to prod and pushed to GitHub** (CI running).
- **Prod:** https://dara.crucibleinsight.com
- **Deploy method:** GitHub→Vercel auto-deploy is **not** firing. Manual flow:
  `edit → pnpm exec tsc --noEmit → pnpm build → git commit → vercel deploy --prod --yes → git push`.
- **Security posture:** Of the original audit, only **DARA-002** and **DARA-017**
  remain open; **DARA-007** is risk-accepted with compensating controls. The SSP
  is drafted (`/app/security/plan`) and the POA&M renders from the findings register.

### Watch-outs (don't trip on these)
- There is a stray nested **`ci-dara/`** directory inside the repo (untracked). It
  was accidentally staged as an embedded git repo this session and removed before
  commit. **Confirm what it is** and delete/relocate it — don't let it get committed.
- `vercel deploy --prod --yes` is the working deploy command this session (despite a
  session-start note claiming the CLI isn't installed — it is).
- Owner-only SQL goes through `prisma/security/apply-sql.ts` (pg + `DIRECT_URL`),
  **not** `prisma db push` (DARA-017 legacy-table risk).

---

## 2. Queue for next session (suggested order)

### A. Operator action — 5 min, do first (you, in the GitHub UI)
**Enable branch protection on `main`** (BUILD_STATUS action #13 — the only thing
keeping DARA-015 from "enforced"):
GitHub → repo **Settings → Branches → Add ruleset / protection rule** for `main`:
- Require status checks to pass → select the **Security** checks + **CodeQL**
- Require branches up to date · Block force pushes · Block deletions
- (Solo dev: skip "require PR approval" for now.)

Then mark DARA-015 enforcement complete in BUILD_STATUS #13 + `/app/security`.

### B. DARA-002 — live secrets in `.env.local` (High, open)
Goal: minimize live keys on local disk; platform secret store is the source of truth.
- Inventory what's actually in `.env.local` vs. what the app reads at runtime.
- Move runtime secrets to Vercel env (already there for prod) and trim the local file
  to only what local dev needs; document a rotation-on-suspicion note.
- Consider the **unused `DARA_*` env vars** (BUILD_STATUS gap #10) at the same time —
  remove or wire them.
- Close-out: update the finding to Remediated/Risk-accepted with evidence.

### C. DARA-017 — no migration history / legacy template schema (open)
Goal: get to a clean, reproducible schema baseline without `prisma db push`.
- Decide: baseline migration from current prod schema (`prisma migrate diff` →
  `migrate resolve`) vs. documented owner-SQL process.
- Reconcile/retire the Supabase template tables that were dropped.
- Keep the `apply-sql.ts` path for owner-only DDL.

### D. Feature backlog (security-adjacent — build when ready)
1. **Per-company admin audit-log viewer** under the (future) **Team** tab.
   `dara_audit_log` is already per-company; build a **read-only**, company-admin-gated
   viewer (filter by actor/action/date, export). Closes the AU "log review" gap.
   Reuse `prismaAdmin` reads scoped by `companyId`; gate on `UserRole = company_admin`.
2. **AI codebase security-audit** (back-office, platform-admin only). Automated
   NIST-800-171 / best-practice vulnerability review of the codebase using the
   **platform Anthropic key**, producing a findings report that feeds the register.

### E. Product backlog (non-security, from §5)
- Reporting phase 2 (weighted Compliance Matrix + PDF/CSV export).
- Evaluation robustness (JobQueue + Vercel Cron worker; per-criterion persona).
- Billing polish (`starter`→"Base" label; handle `subscription.paused`).

---

## 3. Offline / non-code follow-ups
- **ZDR agreements** on platform LLM keys (Anthropic DPA+ZDR primary; OpenAI ZDR on
  approval; Google paid/Vertex ZDR). On signing, update the platform-mode CUI notice
  copy to state ZDR (DARA-007). Tracked in `prisma/security/DARA-007-data-boundary.md`.

---

## 4. Fast restart commands
```bash
git status                 # expect clean main; investigate the stray ci-dara/ dir
git log --oneline -5
pnpm install               # if needed
pnpm exec tsc --noEmit     # typecheck
pnpm build                 # full build
# deploy: vercel deploy --prod --yes  then  git push
```
