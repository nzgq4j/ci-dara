# DARA — Session Handoff

_Prepared: 2026-06-29 (end of session) · for: next session_

This is the "start here tomorrow" doc. Authoritative status lives in
`BUILD_STATUS.md` (§5 backlog, §7 session log); open security findings live on
`/app/security` and in `utils/dara/security-content.ts`.

---

## 1. Where we are

- **Branch:** `main`, clean. Last commit `2c6519a` (solicitation department access)
  is **deployed to prod and pushed to GitHub**. (Prior this session: `b5048d8`
  DARA-002, `287e5af` DARA-017, `c7a7a5f` Teams feature, `78953dd` Team UI rebuild.)
- **Prod:** https://dara.crucibleinsight.com
- **Deploy method:** GitHub→Vercel auto-deploy is **not** firing. Manual flow:
  `edit → pnpm exec tsc --noEmit → pnpm build → git commit → vercel deploy --prod --yes → git push`.
- **Security posture:** **No audit findings remain open.** Both **DARA-002**
  (secrets handling) and **DARA-017** (migration history) were remediated 2026-06-29
  (`prisma/security/DARA-002-secrets.md`, `…/DARA-017-migrations.md`); **DARA-007**
  is risk-accepted with compensating controls. The SSP is drafted
  (`/app/security/plan`) and the POA&M renders from the findings register.

### Watch-outs (don't trip on these)
- **Teams feature is live** (`/app/team`). Schema changes now ship as real Prisma
  migrations via the DARA-017 workflow: edit `schema.prisma` → generate the migration
  (offline diff is fine; no local DB) → `prisma migrate deploy` (owner) → apply any
  RLS/grants for new `dara_*` tables via `apply-sql.ts`. New tables are fail-closed
  for the runtime roles until granted — don't forget the RLS step.
- **Team invite emails** need the Supabase Auth Site URL set (#1) to resolve in prod;
  invitations still function via sign-in without it. The invite email **"from" line**
  (sender name/address) is Supabase config, not code — brand it via Custom SMTP
  (Authentication → Emails → SMTP Settings; see BUILD_STATUS #1).
- **Team page UI was rebuilt to the prototype** (`78953dd`): departments-as-filter-
  chips + unified users table + modals. Single-department-per-user in the UI (schema
  stays multi-capable). "Last Active" reads "Never" until each user's next sign-in
  (`lastLoginAt` only starts recording from this deploy).
- **Solicitation visibility is now department-scoped** (`2c6519a`). Admins see all;
  the creator always sees their own; everyone else only sees solicitations assigned to
  a department they belong to (unassigned ⇒ admins + creator). Enforced **app-layer**
  (`utils/dara/sol-access.ts`) — the detail gate `requireViewableSolicitation` covers
  the page + every mutation; list/dashboard scoped to match; company RLS is the DB
  backstop (DB-level department RLS deferred). **Existing solicitations have no
  departments**, so non-admin/non-creator users can't see them until assigned.
- The stray nested **`ci-dara/`** directory has been **deleted** (resolved
  2026-06-29) — working tree is clean.
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

### B. DARA-002 — live secrets in `.env.local` (High) — ✅ DONE 2026-06-29
Remediated: Vercel established as the authoritative secret store; removed the
redundant duplicate `.env`; trimmed two dead secrets (`STRIPE_PRICING_TABLE_ID`,
`CRON_SECRET`) from `.env.local`; restored an accurate secret-free `.env.example`;
documented the model + rotation-on-suspicion runbook in
`prisma/security/DARA-002-secrets.md`. Finding marked **Remediated** in
`security-content.ts` (residual on-disk presence risk-accepted with controls).
- **Still deferred** (BUILD_STATUS gap #10): the **unused `DARA_*` Vercel vars** were
  left in place (deleting integration-managed vars can be reverted); revisit when the
  Supabase integration is reconnected/removed.
- **Noticed, not fixed:** prod has `STRIPE_PUBLISHABLE_KEY` but the client reads
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — verify the billing page renders in prod.
- **Note:** `CRON_SECRET` was removed; **regenerate it** when the JobQueue cron worker
  is built.

### C. DARA-017 — migration history / schema baseline — ✅ DONE 2026-06-29
Remediated: read-only introspection confirmed prod is clean (12 `dara_*` tables, no
legacy/template tables, no `auth.users` trigger — the legacy-drift half was already
resolved by earlier work). `schema.prisma` matched the live DB with zero drift, so
the DB was baselined to `prisma/migrations/0_init` (generated via `migrate diff` →
marked applied via `migrate resolve`, DDL not re-run); `migrate status` reports up to
date. Forward workflow is `migrate dev`/`deploy` (no `db push`); the owner-only
security DDL stays in `prisma/security/*.sql` via `apply-sql.ts`. Two-layer model +
manifest + DR rebuild order documented in `prisma/security/DARA-017-migrations.md`
and `prisma/migrations/README.md`.

### Teams — ✅ DONE 2026-06-29 (commit `c7a7a5f`, deployed)
Departments/sub-teams with per-team roles + email invitations. New `/app/team`
(company-admin gated): create teams, invite by email/role/team, manage company
members (org-wide role + active) and per-team membership. `provisionNewUser` attaches
invited users to the existing company/team on first sign-in (was: new company per
signup). New tables `dara_teams` / `dara_team_members` / `dara_invitations` under the
DARA-004 RLS model; first migration via the DARA-017 workflow. Member management
moved out of Settings. Dependency: Supabase Auth Site URL (#1) for invite emails.
Team UI later rebuilt to the prototype (`78953dd`); `lastLoginAt` wired on sign-in.

### Solicitation department access — ✅ DONE 2026-06-29 (commit `2c6519a`, deployed)
Solicitations assignable to **multiple departments** (`dara_solicitation_departments`,
migration `20260629230000` + RLS). **Visibility rules** (chosen): `company_admin` sees
all; the **creator** always sees their own; everyone else sees a solicitation only if
it's assigned to a department they belong to; unassigned ⇒ admins + creator only.
**Who assigns:** admins + creator. **Enforcement:** app-layer (`utils/dara/sol-access.ts`)
— list/dashboard queries filtered; the detail gate `requireViewableSolicitation` covers
the page AND every mutation (so a non-viewer can't act via a direct server-action call),
and child data (docs/criteria/offerors/evaluations) is covered transitively. Company-level
RLS stays the DB backstop; **DB-level department RLS deferred** as hardening. Assign via
checkboxes on create and a Departments card in the detail Overview; list shows dept chips.
**Migration-onset behavior:** existing solicitations have no departments → non-admin/
non-creator users lose visibility to them until an admin/creator assigns departments.

### D. Feature backlog (security-adjacent — build when ready)
1. **Per-company admin audit-log viewer** — the **Team** page now exists, so this has
   a home (add a read-only section/tab there). `dara_audit_log` is already per-company;
   build a **read-only**, company-admin-gated viewer (filter by actor/action/date,
   export). Closes the AU "log review" gap. Reuse `prismaAdmin` reads scoped by
   `companyId`; gate on `UserRole = company_admin`.
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
