# CLAUDE.md — DARA (ci-dara) project instructions

Start-here context lives in `CONTEXT_HANDOFF.md`; the decision/session log is `BUILD_STATUS.md`;
the fast-restart doc is `SESSION_HANDOFF.md`.

## Python / Modal CLI

The project's Python virtual environment is at `.venv` (Python 3.12, gitignored). The **Modal CLI is
installed in this venv**. Run any Python or `modal` command with the environment active:

```powershell
.venv\Scripts\Activate.ps1   # PowerShell, then:
modal <command>
```

or, without activating:

```powershell
python -m modal <command>
```

Use the **PowerShell tool** for Modal commands — the Bash tool runs Git Bash and will not pick up
`Activate.ps1`. Never commit `.venv/`.

The deployed structural parser source is `modal/app.py` (`dara-parser`, workspace `islanista`). **Do not
modify `modal/app.py`** unless a confirmed bug is found. See memory `modal-parser-integration.md`.

## Stack & conventions

- Next.js 14.2.35 (App Router, TypeScript) · Prisma 7 (`@prisma/adapter-pg`) · Supabase (Postgres + Auth +
  Storage) · Stripe · Vercel Pro (Fluid Compute, ~800s function limit).
- `after()` is **not** available in Next 14.2.35 — never use it.
- `toLocaleDateString()` is banned in SSR (hydration-unsafe) — use the UTC-deterministic `fmtDate`/`fmtDateTime`.
- Validate with `npx tsc --noEmit` and `pnpm build` (= `prisma generate && next build`; runs ESLint + TS).
- Package manager: `pnpm`.

## Database & security

- **Migrations only** — `pnpm prisma migrate deploy`. Never `pnpm prisma db push`.
- Every new `dara_*` table is RLS-fail-closed until granted and ships with a paired
  `prisma/security/*.sql` applied via `npx tsx prisma/security/apply-sql.ts <file>`.
- Tenant writes/reads go through `withTenant(companyId, …)` (sets the `app.company_id` GUC for RLS);
  cross-tenant/platform-admin paths use `prismaAdmin` and must justify themselves.
- **Deploy order:** `pnpm prisma migrate deploy` (owner) → apply RLS SQL → `vercel deploy --prod --yes` →
  `git push`. GitHub→Vercel auto-deploy is broken; deploy manually. Commit/push/deploy only when asked.

## Do not modify

`modal/app.py`; the HRLR core `utils/dara/hrlr/{types,parse,resolve,run}.ts`; the `hrlr` JSONB output
format on `dara_requirements`.
