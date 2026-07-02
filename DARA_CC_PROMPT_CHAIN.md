# DARA MVP Launch — Claude Code Prompt Chain

**Purpose:** A sequenced set of prompts to hand to Claude Code one session at a time. Each prompt is self-contained and ends with a defined stopping condition. Do not advance to the next prompt until the stopping condition for the current one is met.

**Before starting any prompt:** Confirm that Task 0 (credential rotation) has been completed by the operator. No development session should open without rotated credentials in `.env.local` and Vercel.

**House rules that apply to every session:**
- Scope is frozen. If Claude Code identifies something outside the current prompt that it believes should be changed, it must note it and stop — not implement it.
- Every session ends with `pnpm exec tsc --noEmit && pnpm build`. Both must pass before the session is closed.
- No deployment until the build is clean.
- The underlying review methodology name must not appear in any string Claude Code writes. If it encounters it in existing code, leave it untouched. Do not add it.

---

## PROMPT 1 — Orient and Audit

**Session objective:** Read the codebase, confirm the current state matches the handoff documentation, and produce a written audit report. No code changes in this session.

---

You are beginning work on the DARA codebase. DARA is a federal proposal review SaaS platform built on Next.js 14.2.35 (App Router), Prisma 7 with `@prisma/adapter-pg`, Supabase (Postgres + Auth + Storage), Stripe, and Vercel.

Start by reading these files in full before doing anything else:
1. `CONTEXT_HANDOFF.md`
2. `BUILD_STATUS.md`
3. `SESSION_HANDOFF.md`
4. `DARA_BUILD_PLAN.md`

After reading all four, audit the codebase against the build plan. For each task in the build plan (Tasks 1 through 8), read the relevant source files and determine:

- What the build plan says the current state is
- What the actual current state in the code is
- Whether they match
- Any discrepancy that would affect the implementation approach

Specifically audit these files:

```
utils/dara/provision.ts           — check trialEndsAt value (14 vs 30 days)
utils/dara/passes.ts              — confirm enqueueReviewRun signature and location
app/app/solicitations/new/page.tsx — confirm createSolicitation action structure
app/app/team/actions.ts           — confirm inviteUser function and location
app/app/dashboard/page.tsx        — confirm server component structure
app/onboarding/OnboardingWizard.tsx — confirm STEPS array and current step count
components/layout/Sidebar.tsx     — confirm current sections and items
app/app/solicitations/[id]/page.tsx — confirm PipelineStepper usage (first 100 lines only)
components/dara/CuiBoundaryModal.tsx — read current copy in full
app/api/cron/passes/route.ts      — confirm whether CRON_SECRET check exists
app/app/billing/page.tsx          — confirm Enterprise plan handling
styles/main.css                   — confirm current token values
tailwind.config.js                — confirm current color extensions
components/dara/theme.ts          — confirm current accent color values
app/layout.tsx                    — confirm current font imports
```

Do not read `app/app/solicitations/[id]/page.tsx` in full — it is very large. Read only the first 100 lines for structural orientation.

After completing the audit, produce a written report in this format:

```
TASK 1 — Trial Fencing
  Status: [matches plan / differs from plan]
  Finding: [one sentence]
  Implementation note: [any adjustment needed]

TASK 2 — Onboarding Simplification
  ...

TASK 3 — Pipeline Navigation and Sidebar
  ...

TASK 4 — Reskin
  ...

TASK 5 — CUI Copy
  ...

TASK 6 — PDF Failure Message
  ...

TASK 7 — Documentation Page
  ...

TASK 8 — Enterprise Plan Guard
  ...

CRON_SECRET CHECK (Task 9.3)
  Status: [present / absent]
  Finding: [one sentence]
```

Do not write any code. Do not modify any files. Produce only the audit report.

**Stopping condition:** Audit report is complete. All files listed above have been read. No files have been modified.

---

## PROMPT 2 — Trial Fencing: Core Utility and Provision Fix

**Session objective:** Implement `utils/dara/trial.ts` and fix the trial period in `provision.ts`. These are the two foundational pieces of Task 1. The enforcement hooks (Tasks 1.2–1.4) and the dashboard bar (Task 1.6) are separate sessions.

---

You are implementing trial usage limit enforcement for DARA. Read the build plan at `DARA_BUILD_PLAN.md`, specifically Task 1 (sections 1.1 and 1.5). Read `CONTEXT_HANDOFF.md` for architectural context.

Before writing any code, read these files:
- `utils/dara/provision.ts` — understand the Company creation pattern and existing `withTenant` usage
- `utils/dara/audit.ts` — understand the `recordAudit` function signature
- `utils/dara/billing.ts` — understand the `isPaidPlan` function (trial detection pattern)
- `utils/prisma.ts` — understand `withTenant` signature

**Step 1: Create `utils/dara/trial.ts`**

Create this file. It must export:

```typescript
export type TrialResource = 'solicitation' | 'review_run' | 'seat';

export class TrialLimitError extends Error {
  constructor(
    public readonly resource: TrialResource,
    public readonly used: number,
    public readonly limit: number
  ) {
    super(`Trial limit reached: ${used} of ${limit} ${resource}s used`);
    this.name = 'TrialLimitError';
  }
}

export async function requireTrialCapacity(
  companyId: bigint,
  resource: TrialResource
): Promise<void>
```

Implementation rules for `requireTrialCapacity`:

1. Fetch the company record using `withTenant`. Select: `plan`, `planStatus`, `trialEndsAt`.
2. If `company.plan !== 'trial'`, return immediately. Paid plans are never gated.
3. If `company.trialEndsAt` is not null and is in the past, call `recordAudit` with `action: 'trial.limit.reached'`, then throw `TrialLimitError(resource, 0, 0)`. (The billing page handles the expired state — the caller redirects to `/app/billing`.)
4. For each resource type, run the appropriate count query using `withTenant`:
   - `solicitation`: count rows in `dara_solicitations` where `companyId` matches. Limit = 2.
   - `review_run`: count distinct `reviewId` values in `dara_reviews` where `companyId` matches and at least one `ReviewPass` row exists for that review. Limit = 3. (Counting reviews-with-passes is more accurate than counting pass rows directly, since each run creates 3 pass rows.)
   - `seat`: count rows in `dara_users` where `companyId` matches and `isActive = true`. Limit = 2.
5. If `used >= limit`, call `recordAudit` with:
   - `action: 'trial.limit.reached'`
   - `companyId`
   - `actorEmail: 'system'`
   - `entityType: resource`
   - `metadata: { used, limit, resource }`
   Then throw `TrialLimitError(resource, used, limit)`.
6. If under the limit, return void.

Use `withTenant` for all Prisma calls. Follow the same import style as `utils/dara/billing.ts`.

**Step 2: Fix `utils/dara/provision.ts`**

Find the line that sets `trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000)`.

Change `14` to `30`. This is the only change to this file.

**Step 3: Verify**

Run:
```bash
pnpm exec tsc --noEmit
```

Fix any TypeScript errors. Do not run the build yet — that comes at the end of Task 1.

**Stopping condition:** `utils/dara/trial.ts` created and type-checks clean. `provision.ts` updated to 30 days. `pnpm exec tsc --noEmit` passes with no errors related to the new file. No other files modified.

---

## PROMPT 3 — Trial Fencing: Enforcement Hooks and Dashboard Bar

**Session objective:** Wire `requireTrialCapacity` into the three creation actions and add the trial status bar to the dashboard. Complete Task 1.

---

You are continuing Task 1 from `DARA_BUILD_PLAN.md`. The `utils/dara/trial.ts` utility is already implemented from the previous session. Read that file first to confirm its exports before modifying anything.

Also read:
- `app/app/solicitations/new/page.tsx` — in full
- `utils/dara/passes.ts` — focus on `enqueueReviewRun` function (around line 60)
- `app/app/team/actions.ts` — focus on `inviteUser` function (around line 25)
- `app/app/dashboard/page.tsx` — in full

**Step 1: Enforce in `createSolicitation` (`app/app/solicitations/new/page.tsx`)**

Inside the `createSolicitation` server action, after the user and daraUser checks but before `tx.solicitation.create(...)`, add:

```typescript
import { requireTrialCapacity, TrialLimitError } from '@/utils/dara/trial';

// Inside createSolicitation, before the Prisma create:
try {
  await requireTrialCapacity(daraUser.companyId, 'solicitation');
} catch (e) {
  if (e instanceof TrialLimitError) {
    redirect('/app/billing?limit=solicitation');
  }
  throw e;
}
```

The redirect to `/app/billing?limit=solicitation` is the correct UX for this server action — the form submits and the server redirects. No inline error display is needed here because the New Solicitation button will be disabled before this action is called (handled below in the dashboard/list).

**Step 2: Enforce in `enqueueReviewRun` (`utils/dara/passes.ts`)**

At the top of the `enqueueReviewRun` function body (before any Prisma writes), add:

```typescript
import { requireTrialCapacity, TrialLimitError } from '@/utils/dara/trial';

// First line inside enqueueReviewRun:
await requireTrialCapacity(companyId, 'review_run');
// TrialLimitError propagates to the caller — the solicitation page catches it
```

Do not add a try/catch here. Let `TrialLimitError` propagate. The solicitation page's server action that calls `enqueueReviewRun` should catch it and return an appropriate error to the client.

In `app/app/solicitations/[id]/page.tsx`, find the server action that calls `enqueueReviewRun`. Wrap the call:

```typescript
try {
  await enqueueReviewRun(review.id, daraUser.companyId);
  triggerWorker();
} catch (e) {
  if (e instanceof TrialLimitError) {
    // Return an error state the UI can display, or redirect to billing
    redirect('/app/billing?limit=review_run');
  }
  throw e;
}
```

Additionally, in the same page, compute a `reviewRunLimitHit` boolean server-side:

```typescript
const reviewCount = await withTenant(daraUser.companyId, tx =>
  tx.review.count({ where: { companyId: daraUser.companyId } })
);
const isTrialing = daraUser.company.plan === 'trial';
const reviewRunLimitHit = isTrialing && reviewCount >= 3;
```

Pass `reviewRunLimitHit` to the component or section that renders the Run Review button. When `reviewRunLimitHit` is true, render the button as:

```tsx
<button
  disabled
  title="You have used all 3 review runs on your trial. Upgrade to continue."
  className={`${btnPrimary} opacity-40 cursor-not-allowed`}
>
  Run Review
</button>
```

**Step 3: Enforce in `inviteUser` (`app/app/team/actions.ts`)**

At the top of the `inviteUser` function body, before creating the `Invitation` row, add:

```typescript
import { requireTrialCapacity, TrialLimitError } from '@/utils/dara/trial';

try {
  await requireTrialCapacity(daraUser.companyId, 'seat');
} catch (e) {
  if (e instanceof TrialLimitError) {
    return { error: 'You have used all 2 seats on your trial. Upgrade to continue.' };
  }
  throw e;
}
```

Match the existing error-return pattern already used in `team/actions.ts` — do not introduce a new error pattern.

**Step 4: Trial status bar in `app/app/dashboard/page.tsx`**

After fetching `daraUser`, add these server-side computations:

```typescript
const isTrialing = daraUser.company.plan === 'trial';
let trialStatus: {
  daysLeft: number;
  solUsed: number;
  reviewsUsed: number;
} | null = null;

if (isTrialing) {
  const [solCount, reviewCount] = await Promise.all([
    withTenant(daraUser.companyId, tx =>
      tx.solicitation.count({ where: { companyId: daraUser.companyId } })
    ),
    withTenant(daraUser.companyId, tx =>
      tx.review.count({ where: { companyId: daraUser.companyId } })
    )
  ]);
  const daysLeft = daraUser.company.trialEndsAt
    ? Math.max(0, Math.ceil((daraUser.company.trialEndsAt.getTime() - Date.now()) / 86400000))
    : 0;
  trialStatus = { daysLeft, solUsed: solCount, reviewsUsed: reviewCount };
}
```

Render the status bar above the main dashboard content, visible only when `trialStatus` is not null:

```tsx
{trialStatus && (
  <div className="mb-6 flex items-center gap-4 rounded-lg border-l-4 border-gold bg-gold/10 px-4 py-3 text-sm">
    <span className="font-semibold text-t1">Trial</span>
    <span className="text-t3">·</span>
    <span className="text-t3">{trialStatus.daysLeft} days remaining</span>
    <span className="text-t3">|</span>
    <span className="text-t3">Solicitations: {trialStatus.solUsed} of 2</span>
    <span className="text-t3">|</span>
    <span className="text-t3">Review runs: {trialStatus.reviewsUsed} of 3</span>
    <Link href="/app/billing" className="ml-auto font-semibold text-navy hover:underline">
      Upgrade →
    </Link>
  </div>
)}
```

Note: `border-gold` and `bg-gold/10` and `text-navy` require the Tailwind tokens added in the reskin task. For now, use the hex literals `border-[#B8952A]`, `bg-[#B8952A]/10`, and `text-[#1B2A4A]` to keep this session independent of Task 4.

**Step 5: Final build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass. Fix all errors before closing the session.

**Stopping condition:** All three enforcement hooks in place and type-checking clean. Dashboard trial status bar renders. `pnpm build` passes. No other files modified beyond those listed in this prompt.

---

## PROMPT 4 — Onboarding Wizard: Three-Step Reduction

**Session objective:** Reduce the onboarding wizard from 6 steps to 3. Complete Task 2.

---

You are implementing Task 2 from `DARA_BUILD_PLAN.md`. Read that task in full before starting.

Read these files before writing any code:
- `app/onboarding/OnboardingWizard.tsx` — in full
- `app/onboarding/actions.ts` — in full
- `app/onboarding/page.tsx` — in full

Understand the current 6-step flow before modifying it: `welcome → profile → org → ai → team → done`.

**What to keep:** `profile`, `ai`, `done`. The profile step captures the user's name. The ai step captures platform vs. BYOK selection. The done step calls `completeOnboarding` and redirects to the dashboard.

**What to remove:** `welcome`, `org`, `team`. Remove these steps from the `STEPS` array.

**Company name handling:** The `org` step currently saves the company name. After removing it, check whether `suggestedCompany` (passed as a prop from the server page) is already populated. If `suggestedCompany` is non-empty (typical for Google OAuth), no user input is needed. If it can be blank (email/password sign-up), add a company name field to the `profile` step. Save it via `saveProfile` or the existing `saveOrganization` action, whichever is cleaner given the existing action signatures.

**Step indicator:** The progress dots or step list must reflect exactly 3 steps. Verify the indicator component counts from `STEPS.length` — if so, removing steps from the array is sufficient.

**AI step copy:** Replace the existing mode labels and descriptions with the plain-language copy from the build plan:
- Platform mode: "Platform AI — No API key required. Standard Anthropic commercial terms. Not recommended for CUI-containing documents."
- BYOK mode: "Bring Your Own Key (BYOK) — Use your own provider API key. Your provider agreement governs data handling. CMMC-compatible configuration path."

**What not to change:**
- `app/onboarding/page.tsx` — change only if required to remove props that no longer exist
- `app/welcome/page.tsx` — do not touch
- The `completeOnboarding` action — must still fire on wizard completion
- The `saveAiMode` action — must still fire when the user selects an AI mode
- The `/app/team` route — do not touch; it is where users manage invitations post-onboarding

**After editing:**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** Wizard has exactly 3 steps (profile, ai, done). Step indicator shows 3 steps. AI step copy is updated. `completeOnboarding` fires on completion. `pnpm build` passes. `app/welcome/page.tsx` and the team route are unchanged.

---

## PROMPT 5 — Solicitation Workspace: Three-Tab Navigation

**Session objective:** Replace the primary solicitation workspace navigation with a three-tab structure (Compliance, Review, Export). Complete the workspace portion of Task 3. The sidebar change is a separate step within this prompt.

---

You are implementing Task 3 from `DARA_BUILD_PLAN.md`. Read that task in full.

Read these files before writing any code:
- `components/dara/PipelineStepper.tsx` — in full
- `app/app/solicitations/[id]/page.tsx` — read the first 150 lines for structure, then search for where `PipelineStepper` is rendered and read that section
- `components/dara/theme.ts` — understand the `card`, `btnPrimary`, `btnGhost` class strings

**Important constraint:** The solicitation detail page (`app/app/solicitations/[id]/page.tsx`) is large. Read only what you need. Do not rewrite the entire file — make targeted changes.

**Step 1: Add a three-tab navigation above the existing PipelineStepper**

The tab state is controlled by a URL search param `?tab=compliance|review|export`. Because this is a server component, the tab value is read from `searchParams`.

Add the tab parameter to the page's props:

```typescript
export default async function SolicitationPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const activeTab = searchParams?.tab ?? 'compliance';
  // ... rest of existing page logic
```

Render the three-tab bar directly in the page JSX, above the current PipelineStepper section:

```tsx
{/* Three-stage primary navigation */}
<div className="mb-6 flex gap-1 border-b border-line">
  {(['compliance', 'review', 'export'] as const).map((tab) => (
    <Link
      key={tab}
      href={`/app/solicitations/${sol.id}?tab=${tab}`}
      className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
        activeTab === tab
          ? 'border-b-2 border-[#B8952A] text-[#1B2A4A]'
          : 'text-t4 hover:text-t2'
      }`}
    >
      {tab === 'compliance' ? 'Compliance' : tab === 'review' ? 'Review' : 'Export'}
    </Link>
  ))}
  {/* Advanced Pipeline toggle — collapses to the full PipelineStepper */}
  <Link
    href={`/app/solicitations/${sol.id}?tab=pipeline`}
    className={`ml-auto px-4 py-2.5 text-xs font-medium text-t5 hover:text-t3 ${
      activeTab === 'pipeline' ? 'text-t3' : ''
    }`}
  >
    Advanced Pipeline ↓
  </Link>
</div>
```

**Step 2: Show content based on the active tab**

Wrap the existing view sections in tab conditionals. The existing view rendering (the big block of JSX in the page) stays intact — you are adding `if (activeTab === '...')` guards around the relevant sections.

Map tabs to existing views as follows:
- `activeTab === 'compliance'`: show the documents upload section AND the compliance matrix section (both rendered in sequence)
- `activeTab === 'review'`: show the color-team reviews section (whichever view renders `ReviewPassPanel`)
- `activeTab === 'export'`: show a new simple section (described below)
- `activeTab === 'pipeline'`: show the existing `PipelineStepper` component with all its existing views and logic

The `PipelineStepper` remains completely unchanged. When `activeTab === 'pipeline'`, render it exactly as before.

**Step 3: Build the Export tab content**

When `activeTab === 'export'`, render a lightweight section:

```tsx
<div className="space-y-6">
  <div className={card + ' p-5'}>
    <h3 className="mb-4 text-sm font-bold text-t1">Compliance Matrix Export</h3>
    <p className="mb-4 text-sm text-t4">
      Download the compliance matrix as CSV (opens in Excel) or as a Word document.
    </p>
    {/* Reuse the existing MatrixExport component */}
    <MatrixExport solicitationId={sol.id} companyId={daraUser.companyId} />
  </div>

  {/* Review summary — aggregate pass scores across all reviews */}
  {reviews.length > 0 && (
    <div className={card + ' p-5'}>
      <h3 className="mb-4 text-sm font-bold text-t1">Review Summary</h3>
      {/* For each review, show its pass scores */}
      {reviews.map(rv => (
        <div key={rv.id.toString()} className="mb-3 border-b border-line pb-3 last:border-0 last:pb-0">
          <div className="mb-1 text-xs font-medium text-t2">{rv.name}</div>
          <div className="flex gap-4 text-xs text-t4">
            {rv.passes.map(p => (
              <span key={p.passType}>
                {p.passType === 'compliance_format' ? 'P1' :
                 p.passType === 'technical_responsiveness' ? 'P2' : 'P3'}
                {': '}
                {p.status === 'complete' && p.score != null ? `${p.score}/100` : p.status}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )}
</div>
```

Make sure `reviews` is fetched with passes included. If the existing query already fetches `passes`, reuse it. If not, add `include: { passes: true }` to the reviews query.

**Step 4: Simplify the sidebar (`components/layout/Sidebar.tsx`)**

Read the current file. Apply the simplified section structure from the build plan:

```
WORKSPACE
  Dashboard
  Solicitations

ACCOUNT
  Billing
  Settings
  Security
  Admin  (platform admins only, gated as before)

ORGANIZATION  (company_admin only)
  Company
  Team
```

Remove the `Analysis` section entirely. Remove `Personas` from the `items` array (the route `/app/personas` stays; only the sidebar link is removed).

Add a link to Personas from `app/app/settings/page.tsx` — a simple "Manage reviewer personas →" link pointing to `/app/personas`.

Change the plan label from `text-[#3b6ef0]` to `text-[#B8952A]` (gold — this anticipates the reskin so you are not undoing work in the next session).

**Step 5: Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** Three-tab navigation renders on solicitation detail page. Compliance, Review, and Export tabs each show correct content. "Advanced Pipeline" link reveals the existing PipelineStepper. Amendments view is not reachable from the three tabs. Sidebar has the simplified structure. Personas removed from sidebar nav but route still accessible. `pnpm build` passes.

---

## PROMPT 6 — Reskin Part A: Token Layer, Fonts, Shell, and Auth

**Session objective:** Establish the navy/gold/Inter token layer and apply it to the app shell (sidebar, header, layout) and the sign-in page. This is Step 4.0 through 4.2 of Task 4 from the build plan.

Do not reskin the content pages in this session. Shell and auth only.

---

You are beginning the navy/gold/Inter light theme reskin. Read Task 4 of `DARA_BUILD_PLAN.md` in full before starting. Read the existing `styles/main.css`, `tailwind.config.js`, `components/dara/theme.ts`, and `app/layout.tsx` before writing any code.

This is a measured, page-by-page reskin. This session covers the token layer and the shell only.

**Step 1: Token layer — `styles/main.css`**

In the `:root, [data-theme='light']` block, add two new custom properties after the existing ones:

```css
--c-navy: 27 42 74;    /* #1B2A4A */
--c-gold: 184 149 42;  /* #B8952A */
```

Do not change the existing light-mode token values (`--c-bg` through `--c-t5`). Do not modify the `[data-theme='dark']` block.

**Step 2: Tailwind config — `tailwind.config.js`**

In the `extend.colors` object, add:

```js
navy: 'rgb(var(--c-navy) / <alpha-value>)',
gold: 'rgb(var(--c-gold) / <alpha-value>)',
```

**Step 3: theme.ts — replace blue accent**

In `components/dara/theme.ts`, replace all occurrences of `#3b6ef0` with navy or gold as follows:

- `btnPrimary` background: `bg-navy hover:bg-navy/90` (replacing `bg-[#3b6ef0] hover:bg-[#2f5fd6]`)
- `fieldClasses` focus: `focus:border-gold focus:ring-gold` (replacing `focus:border-[#3b6ef0] focus:ring-[#3b6ef0]`)
- `checkboxClasses` accent: `accent-gold` (replacing `accent-[#3b6ef0]`)
- `accentEyebrow` text: `text-gold` (replacing `text-[#3b6ef0]`)
- `statusBadge.processing` and `statusBadge.running`: change `text-[#6f9bf5]` and `bg-[#3b6ef0]/20` to `text-navy/70` and `bg-navy/10`
- `btnGhost` hover border: `hover:border-navy/30` (replacing `hover:border-[#3b6ef0]/50`)

Do not change any other values in `theme.ts`.

**Step 4: Font — `app/layout.tsx`**

Replace the IBM Plex font imports with Inter. The current imports will look something like `IBM_Plex_Sans` and `IBM_Plex_Mono`. Replace them:

```typescript
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});
```

Update the `className` on `<html>` or `<body>` to use `inter.variable` and `mono.variable` (same pattern as the current IBM Plex variables).

**Step 5: Default to light theme**

In `app/layout.tsx`, find where `ThemeProvider` is configured (it likely has `defaultTheme` and `attribute` props). Set `defaultTheme="light"` and `forcedTheme="light"` (or `enableSystem={false}`). The application is light-theme only for the MVP.

**Step 6: Sidebar reskin — `components/layout/Sidebar.tsx`**

Apply navy/gold styling to the sidebar. Key changes:

- `<aside>` background: change from `bg-surf3` to `bg-navy`
- Logo/company border: `border-navy/20`
- Plan label: already changed to `text-[#B8952A]` in Prompt 5 — if not done, change it to `text-gold` now
- Section labels (the uppercase mono labels): `text-white/30`
- Active nav link: `bg-white/10 text-white` (removing the blue `bg-[#3b6ef0]/15 text-t1`)
- Inactive nav link: `text-white/60 hover:bg-white/10 hover:text-white` (removing `text-t4 hover:bg-surf2 hover:text-t1`)
- User name: `text-white/90`
- User role: `text-white/50`
- Avatar gradient: `from-navy to-gold` (or keep existing if it already reads well on navy)
- Sign out button: `text-white/40 hover:text-white`
- Border between logo area and plan: `border-navy/20`
- Remove `<ThemeToggle />` from the sidebar JSX entirely

**Step 7: Sign-in page — `app/signin/[id]/page.tsx`**

Read the current file. Apply the two-panel layout if not already present:
- Left panel: navy background, DARA logo centered, tagline in white/60
- Right panel: white/light background (`bg-surf`), auth form

Apply Inter font (inherits from `app/layout.tsx` after Step 4 — no per-page font import needed).

Primary action button on the form: will automatically use navy from `btnPrimary` in `theme.ts` after Step 3.

Focus rings on inputs: will automatically use gold from `fieldClasses` after Step 3.

**Step 8: Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** Token layer established with navy and gold CSS custom properties and Tailwind colors. Inter font active. Sidebar is navy with gold active states and white text. `ThemeToggle` removed. Sign-in page is two-panel. `pnpm build` passes. Content pages (dashboard, solicitation workspace, settings, etc.) are not reskinned yet.

---

## PROMPT 7 — Reskin Part B: Dashboard and Solicitation Pages

**Session objective:** Apply navy/gold/Inter styling to the dashboard, solicitation list, new solicitation form, and solicitation detail workspace tabs. Steps 4.3 through 4.5 of Task 4.

---

You are continuing the DARA reskin. The token layer, fonts, sidebar, and auth page are complete from the previous session. Read `components/dara/theme.ts` to confirm the current `btnPrimary`, `card`, and other class strings before starting.

Read these files before writing any code:
- `app/app/dashboard/page.tsx`
- `app/app/solicitations/page.tsx`
- `app/app/solicitations/new/page.tsx`

For the solicitation detail page, read only the JSX rendered under each of the three tabs (search for `activeTab === 'compliance'`, `activeTab === 'review'`, `activeTab === 'export'`) — do not re-read the server action functions.

**Dashboard (`app/app/dashboard/page.tsx`)**

- Stat cards: `bg-surf border border-line` surface. Stat value: `text-navy font-bold`. Label: `text-t4`.
- "New Solicitation" button: `bg-navy text-white` (inherits from `btnPrimary` in theme.ts — verify it renders correctly; if the button uses `btnPrimary` already, no change needed).
- Solicitation table header row: `bg-surf3 text-t4`.
- Plan panel or any sidebar-style panel: navy left-border accent (`border-l-4 border-navy`).
- Page heading: `text-navy font-bold`.
- Trial status bar (from Task 1): confirm it uses `border-[#B8952A]` / `bg-[#B8952A]/10` — change those literals to `border-gold` and `bg-gold/10` now that the tokens exist.

**Solicitation list (`app/app/solicitations/page.tsx`)**

- Table header: `bg-surf3`.
- "New Solicitation" button: `btnPrimary` (navy, from theme.ts).
- Row hover: `hover:bg-surf2`.
- Page heading: `text-navy font-bold`.

**New solicitation form (`app/app/solicitations/new/page.tsx`)**

- Card surface: `bg-surf border border-line` via `card` from theme.ts.
- Submit button: `btnPrimary` (navy).
- Labels and inputs: `labelClasses` and `fieldClasses` from theme.ts (focus rings now gold from the theme.ts update).

**Solicitation detail tab navigation**

The three-tab nav bar added in Prompt 5 uses hex literals `border-[#B8952A]` and `text-[#1B2A4A]`. Replace those with `border-gold` and `text-navy` now that the Tailwind tokens exist.

The "Advanced Pipeline" link already uses `text-t5` — no change needed.

**Solicitation detail Compliance tab**

- Matrix table header row: `bg-surf3 text-t4`.
- Matrix table body rows: `bg-surf` alternating with `bg-surf2` (or `hover:bg-surf2`).
- Action buttons ("Generate", "Sync"): `btnPrimary` (navy).
- Export buttons: `btnGhost` (ghost, consistent with existing).

**Solicitation detail Review tab**

- Pass cards in `ReviewPassPanel`: card surface `bg-surf border-line`.
- Pass type label (P1/P2/P3): `text-navy font-semibold`.
- Score badge when complete: `bg-navy/10 text-navy font-bold` or `bg-gold/10 text-gold font-bold` — choose whichever reads better against the light card.
- Findings severity badges: keep existing colors (critical = red, high = orange, etc.) — they render correctly on a light surface.
- "Run Review" and "Re-run" buttons: `btnPrimary` (navy).

**Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** Dashboard, solicitation list, new solicitation form, and solicitation detail workspace tabs all render with navy/gold/Inter. Trial status bar uses Tailwind tokens. `pnpm build` passes. Settings, team, company, billing, personas, security, and account pages are not yet reskinned.

---

## PROMPT 8 — Reskin Part C: Remaining Pages

**Session objective:** Apply navy/gold/Inter to all remaining `/app` pages. Complete Task 4 including the Step 4.8 visual QA grep.

---

You are completing the DARA reskin. Token layer, fonts, sidebar, auth, dashboard, and solicitation pages are complete. This session covers the remaining pages.

Read each file fully before modifying it. Apply the token-based pattern consistently: `bg-surf` for card surfaces, `bg-surf3` for table headers, `text-navy` for page headings and primary text, `text-gold` for accents, `btnPrimary` (now navy) for primary actions, `btnGhost` for secondary actions.

Pages to reskin:

**`app/app/settings/page.tsx` and `app/app/settings/CompanyAIConfig.tsx`**
- Card headers: `text-navy font-bold`
- Save button: `btnPrimary`
- AI mode toggle: active state uses `border-gold bg-gold/10` for the selected mode card

**`app/app/team/page.tsx` and `app/app/team/TeamView.tsx`**
- Table rows: `bg-surf hover:bg-surf2`
- Role badges: keep existing colors
- "Invite User" button: `btnPrimary`
- Department filter chips: active chip uses `bg-navy text-white`, inactive uses `bg-surf2 text-t4`

**`app/app/company/page.tsx`**
- Card surfaces: `bg-surf border-line`
- Save button: `btnPrimary`
- Page heading: `text-navy font-bold`

**`app/app/billing/page.tsx`**
- Plan card selected state: `border-navy ring-1 ring-navy`
- Gold accent on selected card: checkmark or badge in gold
- "Upgrade" button: `btnPrimary` (navy)
- Enterprise card: `border-line only` — confirm it shows a "Contact us" link and no Checkout button (this is also the Task 8 check)

**`app/app/personas/page.tsx` and `components/dara/PersonaManager.tsx`**
- Card surfaces: `bg-surf border-line`
- Active persona badge: `bg-gold/10 text-gold`
- "Add Persona" / primary action: `btnPrimary`

**`app/app/security/page.tsx` and `app/app/security/plan/page.tsx`**
- Page heading: `text-navy font-bold`
- Severity badges: keep existing red/amber/green — they work on light surfaces
- Finding cards: `bg-surf border-line`

**`app/account/page.tsx`**
- Card: `bg-surf border-line`
- Save button: `btnPrimary`

**`app/onboarding/OnboardingWizard.tsx`** (already simplified in Prompt 4)
- Step indicator dots: active = `bg-gold`, completed = `bg-navy`, future = `bg-line`
- Primary button: `btnPrimary` (navy)
- Card: `bg-surf border-line`

**`app/welcome/page.tsx`**
- Navy heading, gold accent, `btnPrimary` for the CTA

**Step 4.8 — Visual QA grep**

After all pages are complete, run these searches to confirm no blue accent remains:

```bash
grep -rn "#3b6ef0" components/ app/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "IBM_Plex\|ibm-plex\|ibm_plex" app/ components/ --include="*.tsx" --include="*.ts"
grep -rn "ThemeToggle" components/ app/ --include="*.tsx"
```

The first search should return zero results (except possibly in color-team pipeline dot definitions — if those use `#3b6ef0` as a gate color, leave them untouched).
The second search should return zero results.
The third search should return zero results.

Report the output of each grep. If any unexpected results appear, fix them before closing the session.

**Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** All `/app` pages use navy/gold/Inter. All three grep checks return zero unexpected results. `pnpm build` passes.

---

## PROMPT 9 — CUI Copy, PDF Message, Documentation Page, Enterprise Guard

**Session objective:** Complete Tasks 5, 6, 7, and 8 from the build plan. These are four independent, focused changes grouped into one session because each is small.

---

You are implementing Tasks 5, 6, 7, and 8 from `DARA_BUILD_PLAN.md`. Read each task section in the build plan before starting.

**Task 5 — CUI Boundary Notice and AI Mode Copy**

Read `components/dara/CuiBoundaryModal.tsx` in full.

Replace the modal body copy for each AI mode with the approved text from the build plan. Do not change the modal's structure, the "I understand" button, or any props. Change only the text strings inside the modal.

**Platform mode copy** (exact text, no paraphrasing):

> **Data Handling Notice**
>
> Your documents will be sent to Anthropic's API for processing. This connection uses standard commercial API terms. No Zero Data Retention (ZDR) agreement is in effect between this platform and Anthropic. Platform mode is not recommended for documents that contain Controlled Unclassified Information (CUI).
>
> If your documents may contain CUI, configure BYOK mode in Settings and use your own API key under a provider agreement that includes ZDR.

**BYOK mode copy** (exact text, no paraphrasing):

> **Data Handling Notice**
>
> Your documents will be sent to the AI provider you have configured using your own API key. The data handling terms of your provider agreement govern this connection. If you hold a Zero Data Retention agreement with your provider, this is the CMMC-compatible configuration path for CUI-containing documents.
>
> DARA does not serve as a ZDR counterparty. Your provider agreement is the controlling instrument.

Read `app/app/settings/CompanyAIConfig.tsx` and update the mode labels to the plain-language copy from the build plan.

Read the `ai` step in `app/onboarding/OnboardingWizard.tsx` and confirm the plain-language copy from Prompt 4 is in place. If it was not completed in Prompt 4, apply it now.

**Pre-launch methodology audit:** Run this search across the codebase:

```bash
grep -rn "STORM\|ShipleyGroup\|Shipley\|Huthwaite\|Miller Heiman\|APMP" \
  utils/ app/ components/ \
  --include="*.ts" --include="*.tsx" --include="*.md" \
  2>/dev/null
```

Report the results. If any hits appear in user-facing strings or prompt text, remove them. If they appear only in comments or non-user-facing code, note them but leave them.

(Note: the above search uses generic methodology-adjacent terms as a proxy. If you know the specific methodology name from context, search for that directly. Do not include it in this prompt or any output.)

**Task 6 — Image-Only PDF Failure Message**

Read `utils/dara/documents.ts`. Find where `extractionStatus = 'failed'` is set or returned.

In `app/app/solicitations/[id]/page.tsx`, find the section that renders the document list or upload area. Where `SolDocument.extractionStatus === 'failed'` is displayed, replace any generic error message or missing message with:

```
Text extraction failed. This file may be a scanned or image-based PDF without a text layer.
Please re-upload a text-searchable PDF, or add requirements to the compliance matrix manually.
```

Display this as a `<p>` or `<div>` with `text-sm text-[#e07d7d]` (the existing error text color in the design system) adjacent to the document row. Do not change the document upload logic — only the displayed error message.

**Task 7 — In-App Documentation Page**

Check whether `app/app/docs/page.tsx` exists. If it does not, create it.

The page must be a standard Next.js App Router server component. It requires authentication the same way other `/app` pages do — check `app/app/layout.tsx` to confirm the shell handles this automatically (it does, via the layout).

Populate the page with the five sections from the build plan: How DARA Works, Supported File Formats, The Three Review Passes, Platform Mode vs. BYOK, and Support. Use the exact content from the build plan. For the Support section, use `support@crucibleinsight.com` as the contact address (or whatever address is appropriate — if uncertain, use that address as a placeholder).

Style the page using `card`, `cardPad`, and typography classes from `theme.ts`. Headings in `text-navy font-bold`. Section text in `text-t2 text-sm`.

Add a "Help" link to `components/layout/Sidebar.tsx` under the Account section, pointing to `/app/docs`. Use a `HelpCircle` or `BookOpen` icon from `lucide-react`.

**Task 8 — Enterprise Plan Guard**

Read `app/app/billing/page.tsx` in full. Search for any code path that creates a Stripe Checkout Session for the `enterprise` plan.

If such a path exists, remove it. The Enterprise card must render a "Contact us" link only:

```tsx
<a
  href="mailto:sales@crucibleinsight.com"
  className="inline-flex items-center gap-1 text-sm font-medium text-navy hover:underline"
>
  Contact us for Enterprise pricing →
</a>
```

If no Checkout path exists for Enterprise and the card already shows only a contact link, confirm that in your output and make no change.

**Build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass.

**Stopping condition:** CUI modal copy updated for both modes. AI mode labels updated in onboarding and settings. Methodology audit grep run and results reported. PDF failure message is specific and actionable. Documentation page exists with all five sections. Help link in sidebar. Enterprise plan guard confirmed. `pnpm build` passes.

---

## PROMPT 10 — CRON_SECRET Guard and Quality Gates

**Session objective:** Add the CRON_SECRET authentication check to the worker route (code portion of Task 9.3), then run all automated quality gates from Task 10. This is the final development session before operator actions and launch.

---

You are completing the last code change and running all automated quality gates from `DARA_BUILD_PLAN.md`.

**Step 1: CRON_SECRET guard — `app/api/cron/passes/route.ts`**

Read the file in full.

Add authentication at the top of the route handler. If `process.env.CRON_SECRET` is set, require that the request includes the header `Authorization: Bearer <CRON_SECRET>`. If the header is missing or does not match, return a 401 response immediately.

```typescript
export async function GET(request: Request) {
  // CRON_SECRET guard — if the env var is set, require it as a Bearer token.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
  // ... existing handler logic continues unchanged
}
```

If the route already has this check, confirm it in your output and make no change.

**Step 2: Final TypeScript and build check**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must pass with zero errors.

**Step 3: DARA-004 isolation test**

```bash
npx tsx prisma/security/dara004-isolation-test.ts
```

Report the result. Must be 14/14. If any test fails, stop and investigate before proceeding. Do not deploy until this passes.

**Step 4: Security headers check**

```bash
curl -s -I https://dara.crucibleinsight.com | grep -i "content-security\|strict-transport\|x-frame\|x-content-type\|referrer\|permissions"
```

Report the output. All six headers must be present.

**Step 5: Remaining grep audits**

```bash
# Confirm no blue accent remains
grep -rn "#3b6ef0" components/ app/ styles/ \
  --include="*.tsx" --include="*.ts" --include="*.css"

# Confirm no IBM Plex remains
grep -rn "IBM_Plex\|ibm-plex" app/ components/ \
  --include="*.tsx" --include="*.ts"

# Confirm ThemeToggle is removed
grep -rn "ThemeToggle" components/ app/ --include="*.tsx"

# Confirm enterprise checkout is not reachable
grep -rn "enterprise.*checkout\|checkout.*enterprise\|Tm7kr" \
  app/ utils/ --include="*.tsx" --include="*.ts"
```

Report the output of each grep. Any unexpected hits must be resolved before the session is closed.

**Step 6: Deploy**

```bash
vercel deploy --prod --yes
git push
```

After deployment, hard-refresh the browser and verify production is healthy.

**Step 7: Post-deploy isolation test on production schema**

```bash
npx tsx prisma/security/dara004-isolation-test.ts
```

Must still be 14/14 after the deployment.

**Stopping condition:** CRON_SECRET guard in place (or confirmed already present). `pnpm build` clean. DARA-004 isolation test 14/14 pre- and post-deploy. Security headers confirmed. All grep audits clean. Production deployed and healthy.

---

## Operator Checklist (Between Prompts 10 and 11)

After Prompt 10 is complete and production is deployed, the operator must complete these actions before the final quality gate session begins. These cannot be delegated to Claude Code — they require dashboard access.

```
[ ] Task 9.1  — Set platform model to claude-sonnet-4-6 in /app/admin → Platform AI
[ ] Task 9.2  — Set CRON_SECRET in Vercel (all environments); redeploy
[ ] Task 9.4  — Supabase Auth: Site URL = https://dara.crucibleinsight.com
               Add redirect URLs: https://dara.crucibleinsight.com/** and http://localhost:3000/**
[ ] Task 9.5  — Supabase Auth: Enable Confirm email
[ ] Task 9.6  — Supabase Auth: Configure custom SMTP sender; update email templates
[ ] Task 9.7  — Stripe: Verify webhook subscribed to created + updated + deleted events
               Confirm webhook URL has no trailing dot
[ ] Task 9.8  — Stripe: Activate Customer Portal
[ ] Task 9.9  — GitHub: Enable branch protection on main (CI gates required; no force-push)
[ ] Task 9.10 — Vercel: Reconnect GitHub integration for auto-deploy
[ ] Task 9.11 — Supabase: Confirm PITR enabled with 7-day recovery window
```

Do not open Prompt 11 until all operator checklist items are marked complete.

---

## PROMPT 11 — Final Quality Gate Session

**Session objective:** Run the complete launch readiness checklist. Identify and fix any remaining issues. Produce a written launch status report.

---

You are running the final quality gate session for the DARA MVP launch. All development tasks are complete. All operator configuration actions are confirmed complete. Read `DARA_BUILD_PLAN.md` Task 10 in full.

Work through each quality gate in order. For each one, report the result explicitly before moving to the next.

**Gate 1: TypeScript and build**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Report: PASS or FAIL. If FAIL, fix all errors and re-run before proceeding.

**Gate 2: DARA-004 isolation test**

```bash
npx tsx prisma/security/dara004-isolation-test.ts
```

Report: X/14 passed. If not 14/14, stop and do not proceed.

**Gate 3: Security headers**

```bash
curl -s -I https://dara.crucibleinsight.com/app/dashboard
```

Confirm all six required headers are present. Report each one.

**Gate 4: Trial limit behavioral check**

Using the Prisma client or direct DB query (via `npx tsx` and a small script if needed), verify the following on a test trial account in production:

- `Company.plan === 'trial'`
- `Company.trialEndsAt` is 30 days from the account creation date (not 14)
- The solicitation count is tracked correctly
- The review count is tracked correctly

If you cannot verify this without a live test account, note what would need to be confirmed manually.

**Gate 5: Enterprise plan guard check**

```bash
grep -rn "enterprise" app/app/billing/page.tsx
```

Confirm that no Stripe Checkout Session creation exists for the `enterprise` plan in the current code. Report the relevant lines.

**Gate 6: Grep audits**

```bash
grep -rn "#3b6ef0" components/ app/ styles/ --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "IBM_Plex\|ibm-plex" app/ components/ --include="*.tsx" --include="*.ts"
grep -rn "ThemeToggle" components/ app/ --include="*.tsx"
```

Report output. Must be zero unexpected hits on all three.

**Gate 7: CRON_SECRET guard**

```bash
grep -n "CRON_SECRET\|Unauthorized\|401" app/api/cron/passes/route.ts
```

Confirm the guard is in place. Report the relevant lines.

**Gate 8: CUI modal copy check**

```bash
grep -n "ZDR\|Zero Data Retention\|standard commercial\|provider agreement" \
  components/dara/CuiBoundaryModal.tsx
```

Confirm both mode-specific copy blocks are present. Report the relevant lines.

**Gate 9: Documentation page**

```bash
ls app/app/docs/
grep -n "Three Review Passes\|BYOK\|CUI" app/app/docs/page.tsx | head -10
```

Confirm the file exists and contains the required sections.

**Gate 10: Produce launch status report**

After all gates are complete, produce a written launch status report in this format:

```
DARA MVP Launch Status Report
Generated: [date]

GATE RESULTS
  Gate 1 — TypeScript/Build:        [PASS / FAIL]
  Gate 2 — DARA-004 Isolation:      [PASS (14/14) / FAIL]
  Gate 3 — Security Headers:        [PASS / FAIL — list missing headers]
  Gate 4 — Trial Limit Behavior:    [CONFIRMED / NEEDS MANUAL VERIFICATION]
  Gate 5 — Enterprise Guard:        [PASS / FAIL]
  Gate 6 — Blue Accent Grep:        [CLEAN / [N] unexpected hits]
  Gate 6 — IBM Plex Grep:           [CLEAN / [N] unexpected hits]
  Gate 6 — ThemeToggle Grep:        [CLEAN / [N] unexpected hits]
  Gate 7 — CRON_SECRET Guard:       [IN PLACE / ABSENT]
  Gate 8 — CUI Modal Copy:          [CONFIRMED / MISSING]
  Gate 9 — Documentation Page:      [EXISTS / MISSING]

OPEN ITEMS (items requiring manual verification or operator action)
  [list any items that cannot be confirmed by code inspection alone]

REMAINING MANUAL CHECKS (for the product owner)
  [ ] End-to-end smoke test (see DARA_BUILD_PLAN.md Task 10.5)
  [ ] Accessibility audit with axe-core on primary workflow pages
  [ ] Visual QA on all /app pages in production browser
  [ ] CUI notice copy review and approval
  [ ] Usability test — one representative user per persona

LAUNCH RECOMMENDATION
  [All automated gates passed. Proceed to manual verification.] OR
  [N gates failed. Resolve before proceeding.]
```

**Stopping condition:** All automated gates run and reported. Launch status report produced. Any gate failures are either fixed or explicitly documented as requiring operator or manual resolution.

---

## Session Management Notes

**Each prompt is one Claude Code session.** Do not combine prompts. The stopping condition at the end of each prompt is the gate that controls advancement.

**If Claude Code encounters something unexpected** — a file that does not match the description, an error that suggests a prior session left something incomplete, or a dependency the prompt did not anticipate — it should stop, report the discrepancy, and ask for guidance rather than proceeding with an assumption.

**Commit after each session.** After every prompt's stopping condition is met and `pnpm build` is clean:

```bash
git add -A
git commit -m "DARA MVP: [description of what this session completed]"
git push
```

Do not deploy to production until Prompt 10 explicitly deploys. Earlier sessions commit and push but do not deploy.

**The deferred list is enforced.** If Claude Code suggests implementing anything from the deferred list in `DARA_BUILD_PLAN.md`, decline and redirect it to the current prompt's scope.
