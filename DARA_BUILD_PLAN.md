# DARA — MVP Launch Build Plan

**Repository:** `crucible-insight/ci-dara` · **Branch:** `main` · **HEAD:** `d55ccdf`
**Production:** https://dara.crucibleinsight.com
**Stack:** Next.js 14.2.35 (App Router) · Prisma 7 (`@prisma/adapter-pg`) · Supabase (Postgres + Auth + Storage) · Stripe · Vercel (Fluid Compute)

Read `CONTEXT_HANDOFF.md` and `BUILD_STATUS.md` before starting. The full architecture is documented there. This plan does not repeat that context; it references it.

---

## Scope Freeze

**No new features.** Every task in this plan is a confirmed launch blocker or a required pre-launch operator action. If anything is encountered that is not in this list, defer it. Do not add capabilities; close gaps.

---

## Work Order

Execute in the order listed. Each item identifies the files to change, the exact behavior required, and the acceptance test.

---

## TASK 0 — Credential Rotation (Operator — Do This First, Before Any Code Work)

The `.env.local` file contains live production credentials. Rotate all of the following before proceeding:

| Secret | Where to Rotate |
|--------|----------------|
| Supabase service role key | Supabase dashboard → Settings → API |
| Supabase anon key (if compromised) | Supabase dashboard → Settings → API |
| Stripe secret key (`sk_live_...`) | Stripe dashboard → Developers → API keys |
| Stripe webhook secret (`whsec_...`) | Stripe dashboard → Developers → Webhooks → endpoint |
| Anthropic platform API key (`sk-ant-...`) | console.anthropic.com → API Keys |
| `APP_KEY` (AES-256 master key) | Generate new 32+ byte hex; update everywhere |
| `dara_app` DB role password | Run `prisma/security/rotate-dara004-roles.sh` |
| `dara_admin` DB role password | Same script |

After rotation: update all values in **Vercel env (all environments)** via `vercel env add ... --value ... --force`, update `.env.local`, and redeploy. Verify production is healthy before starting development work.

---

## TASK 1 — Trial Usage Limit Enforcement

**Status:** Not implemented. This is the only net-new code required before launch.
**PRD:** REQ-F-020, REQ-F-021, Constraint C-006.

No schema changes are needed. `Company.plan`, `Company.planStatus`, and `Company.trialEndsAt` are already present in the schema.

**Note:** `provision.ts` currently sets `trialEndsAt` to 14 days. Change it to **30 days** (`30 * 86400 * 1000`) to match the PRD.

### 1.1 — Create `utils/dara/trial.ts`

Create this file from scratch.

```typescript
// utils/dara/trial.ts
// Trial plan usage limit enforcement.
// requireTrialCapacity() throws TrialLimitError when the company is on a trial
// plan and has exhausted the relevant resource. Read and export operations are
// never gated — only creation actions.
```

**Required exports:**

```typescript
export type TrialResource = 'solicitation' | 'review_run' | 'seat';

export class TrialLimitError extends Error {
  resource: TrialResource;
  used: number;
  limit: number;
  constructor(resource: TrialResource, used: number, limit: number) { ... }
}

export async function requireTrialCapacity(
  companyId: bigint,
  resource: TrialResource
): Promise<void>
```

**Limits to enforce:**

| Resource | Limit | How to count |
|----------|-------|-------------|
| `solicitation` | 2 | `COUNT(*)` from `dara_solicitations` where `companyId` matches |
| `review_run` | 3 | `COUNT(*)` from `dara_review_passes` where `companyId` matches (each `enqueueReviewRun` creates 3 pass rows; count by distinct `reviewId` not pass rows — count `dara_reviews` with at least one pass instead, or count `dara_job_queue` entries of type `evaluate` — choose the most accurate for your implementation) |
| `seat` | 2 | Count active `dara_users` where `companyId` and `isActive = true` |

**Time gate:** If `company.trialEndsAt` is in the past, throw `TrialLimitError` for any resource with `used = limit = 0` (or a dedicated `expired` signal — your choice, as long as the billing page is triggered).

**Skip enforcement entirely** when `company.plan !== 'trial'` — paid plans are never gated.

**Audit on limit hit:** call `recordAudit` with `action: 'trial.limit.reached'`, `entityType: resource`, and metadata including `{ used, limit }`.

Use `withTenant` for all DB reads (follows the existing DARA-004 pattern).

---

### 1.2 — Enforce in `createSolicitation` (`app/app/solicitations/new/page.tsx`)

The `createSolicitation` server action is at the top of this file. Before `tx.solicitation.create(...)`, add:

```typescript
await requireTrialCapacity(daraUser.companyId, 'solicitation');
```

If `TrialLimitError` is thrown, redirect to `/app/billing?limit=solicitation` (or return an appropriate error the form can display — match the existing error-handling pattern in this file). The UI must show: **"You have used 2 of 2 solicitations on your trial. Upgrade to continue."**

---

### 1.3 — Enforce in `enqueueReviewRun` (`utils/dara/passes.ts`)

`enqueueReviewRun(reviewId, companyId)` is at line 60. Before creating `ReviewPass` rows or the `JobQueue` entry, add:

```typescript
await requireTrialCapacity(companyId, 'review_run');
```

In the solicitation detail page (`app/app/solicitations/[id]/page.tsx`), the Run Review button must be disabled (not just fail after click) when the trial review limit is reached. Pass a `trialLimitHit: boolean` prop or server-render the button as disabled with a `title` tooltip: **"You have used all 3 review runs on your trial. Upgrade to continue."**

---

### 1.4 — Enforce in `inviteUser` (`app/app/team/actions.ts`)

The `inviteUser` function starts at line 25. Before creating the `Invitation` row, add:

```typescript
await requireTrialCapacity(daraUser.companyId, 'seat');
```

Error message: **"You have used all 2 seats on your trial. Upgrade to continue."**

---

### 1.5 — Fix trial period in `utils/dara/provision.ts`

Line 79 currently sets `trialEndsAt: new Date(Date.now() + 14 * 86400 * 1000)`.

Change to `30 * 86400 * 1000` (30 days per the PRD).

---

### 1.6 — Add trial status bar to `app/app/dashboard/page.tsx`

The dashboard is a server component. At the top, after fetching `daraUser`, compute trial status:

```typescript
const isTrialing = daraUser.company.plan === 'trial';
const trialDaysLeft = daraUser.company.trialEndsAt
  ? Math.max(0, Math.ceil((daraUser.company.trialEndsAt.getTime() - Date.now()) / 86400000))
  : 0;
// Also count solicitations used and review runs used for this company
```

Render a status bar **above** the main dashboard content, visible only when `isTrialing`:

```
Trial · 28 days remaining  |  Solicitations: 1 of 2  |  Review runs: 0 of 3  →  Upgrade
```

Style it as a subdued info bar (navy border-left or gold accent). The "Upgrade" link goes to `/app/billing`. The bar disappears entirely for paid accounts.

---

### Task 1 Acceptance Test

1. Create a new account. Confirm `trialEndsAt` is now 30 days out.
2. Create 2 solicitations — both succeed.
3. Attempt to create a 3rd solicitation — blocked with the specific message.
4. Run 3 review runs across the 2 solicitations — all succeed.
5. Attempt a 4th review run — Run button is disabled; clicking nothing happens; tooltip shows the specific message.
6. Invite 2 users — both succeed.
7. Attempt to invite a 3rd — blocked with the specific message.
8. Export a compliance matrix while at the solicitation limit — export succeeds. Read operations are never gated.
9. View review findings while at the review run limit — findings display. Never gated.
10. Upgrade to Base plan via Stripe Checkout. Confirm `company.plan = 'starter'`, trial status bar disappears, all limits lifted.

---

## TASK 2 — Onboarding Wizard: Reduce from 6 Steps to 3

**Status:** 6-step wizard exists in `app/onboarding/OnboardingWizard.tsx`.
**PRD:** REQ-F-002, REQ-UX-003.

### Current steps (from `STEPS` array in `OnboardingWizard.tsx`):
`welcome` → `profile` → `org` → `ai` → `team` → `done`

### Required steps:
`profile` → `ai` → `done`

### What to do:

**Remove** the `welcome`, `org`, and `team` steps from the wizard entirely.

**Keep** `profile` (name), `ai` (AI mode selection — platform or BYOK), and `done` (completion redirect).

The `org` step (company name) is still needed but should be handled in the `profile` step — combine name + company name into one step if the company name isn't already set from provisioning. Check `suggestedCompany` prop; if it is pre-populated from Google OAuth, no user input is needed for company name. If it is blank, add a company name field to the profile step.

The `team` step (invite) is removed from onboarding. Users access team management via `/app/team` after onboarding.

**Actions file** (`app/onboarding/actions.ts`): The `saveOrganization` and `inviteUser` calls from the removed steps are no longer needed in the wizard. `completeOnboarding` must still fire on completion of the `done` step.

**Step indicator:** The progress dots or step list at the top of the wizard must show only 3 steps.

**Time requirement:** A user should complete onboarding in under 5 minutes. The `ai` step copy must use plain language per REQ-UX-009:
- Platform mode: *"Your documents will be processed using the platform's API connection. No API key required. Standard commercial terms apply — not recommended for CUI-containing documents."*
- BYOK mode: *"Bring your own API key. Your provider agreement governs data handling. This is the CMMC-compatible configuration."*

### Acceptance Test

1. Create a new account (email/password). Confirm redirect to `/onboarding`.
2. Wizard shows exactly 3 steps.
3. Complete wizard in under 5 minutes. Confirm `Company.onboardedAt` and `DaraUser.onboardedAt` are set.
4. Dashboard reached with trial status bar visible.
5. Create a new account via Google OAuth. Confirm name and company pre-filled from OAuth.

---

## TASK 3 — Solicitation Workspace: Three-Stage Pipeline Navigation

**Status:** `PipelineStepper` renders a 9-stage color-team pipeline as the primary navigation.
**PRD:** REQ-UX-002, REQ-UX-004.

### What to build:

Replace the primary navigation in `app/app/solicitations/[id]/page.tsx` with a **three-tab structure**:

| Tab | Label | Contains |
|-----|-------|----------|
| 1 | Compliance | Document upload (RFP + proposal draft), Generate Matrix button, compliance matrix table, Sync from AI Review button, Export (CSV + Word) buttons |
| 2 | Review | New Review button, review list, per-review `ReviewPassPanel` (3 pass cards, live polling), Run Review button, per-pass Re-run/Retry |
| 3 | Export | Matrix export (CSV, Word) download buttons + summary of pass scores and finding counts across all completed reviews for this solicitation |

**The existing `PipelineStepper` is not removed.** Make it accessible as an **"Advanced Pipeline"** link or toggle below the three main tabs. It renders on demand, not as the default view.

**The Amendments view** is not accessible from the three-tab navigation in the MVP. It remains in the codebase but is only reachable from the Advanced Pipeline (`tool` entry in the stepper).

**The existing view logic** (`documents`, `compliance`, `overview`, `pink`, `red`, `gold`, `white`, `review`, `amendments`) does not need to be deleted. The three-tab navigation simply maps to a subset of those views:
- Tab 1 "Compliance" → maps to the `documents` view combined with the `compliance` view (or render both in sequence within one tab)
- Tab 2 "Review" → maps to the `pink` / color-team views (whichever contains `ReviewPassPanel`)
- Tab 3 "Export" → a new lightweight view with download buttons and score summary

Keep the tab state in a URL search param (`?tab=compliance|review|export`) so direct links work and browser back/forward navigation is preserved.

### Sidebar: Simplify to 3 Primary Items

Edit `components/layout/Sidebar.tsx`.

**Current sections:** Workspace (Dashboard, Solicitations), Analysis (Personas), Organization (Company, Team), Account (Billing, Settings, Admin, Security).

**Required primary navigation per PRD REQ-UX-004:**

| Item | href |
|------|------|
| Solicitations | `/app/solicitations` |
| Settings | `/app/settings` |
| Billing | `/app/billing` |

Everything else moves to secondary access:
- **Personas** → accessible via Settings page (add a link from `/app/settings` to `/app/personas`). Remove from primary sidebar.
- **Company** → accessible via Settings page or keep under a collapsed "Organization" section visible only to `company_admin`. The PRD specifies Personas goes under Settings; Company and Team can remain under Organization but should not be top-level primary items.
- **Dashboard** → keep; it is the landing page after onboarding.
- **Security** → keep under Account; do not remove.
- **Admin** → keep, visible to platform admins only (already gated).

A reasonable final sidebar structure:

```
WORKSPACE
  Dashboard
  Solicitations

ACCOUNT
  Billing
  Settings      ← link to Personas from within Settings page
  Security
  Admin         ← (platform admins only)

ORGANIZATION    ← (company_admin only, collapsed or secondary)
  Company
  Team
```

Remove the `Analysis` section label. Remove Personas from the sidebar nav (but do not delete the `/app/personas` route — it must remain accessible from Settings).

Remove the blue accent `text-[#3b6ef0]` from the plan label in the sidebar (this is part of the reskin in Task 4, but fix it here since you are already editing this file).

### Acceptance Test

1. Navigate to a solicitation. Three tabs visible: Compliance, Review, Export.
2. Compliance tab shows document upload + matrix table.
3. Review tab shows `ReviewPassPanel` with pass cards and Run Review button.
4. Export tab shows CSV and Word download buttons.
5. "Advanced Pipeline" link present and opens the existing 9-stage stepper when clicked.
6. Amendments view not visible in the three-tab navigation.
7. Sidebar shows Dashboard, Solicitations, Billing, Settings, Security (and Admin if admin).
8. Personas not in sidebar; accessible from Settings page via link.

---

## TASK 4 — Navy/Gold/Inter Light Theme Reskin

**Status:** Current theme is IBM Plex dark. The CSS token layer (`styles/main.css`) and Tailwind config (`tailwind.config.js`) already support a theming system. The tokens need to be updated and Inter needs to replace IBM Plex everywhere.
**PRD:** REQ-UX-001.

This is the largest task. Work page by page. Do not attempt a single-pass global diff.

### Step 4.0 — Token Layer

**`styles/main.css`** — update the `:root` / `[data-theme='light']` values:

```css
:root,
[data-theme='light'] {
  color-scheme: light;
  --c-bg:     240 244 255;   /* keep existing light values */
  --c-surf:   255 255 255;
  --c-surf2:  241 245 249;
  --c-surf3:  232 237 245;
  --c-border: 199 212 232;
  --c-t1:     15  23  42;
  --c-t2:     30  41  59;
  --c-t3:     71  85 105;
  --c-t4:    100 116 139;
  --c-t5:    148 163 184;
  /* NEW — navy and gold as named tokens */
  --c-navy:   27  42  74;    /* #1B2A4A */
  --c-gold:  184 149  42;    /* #B8952A */
}
```

Add `navy` and `gold` to `tailwind.config.js` extend colors:

```js
navy: 'rgb(var(--c-navy) / <alpha-value>)',
gold: 'rgb(var(--c-gold) / <alpha-value>)',
```

**`components/dara/theme.ts`** — update all occurrences of `#3b6ef0` (the blue accent) to use `navy` or `gold` as appropriate:

- Primary button background: navy (`bg-navy`)
- Active nav link: navy background
- Focus ring: gold (`ring-gold`)
- Plan label eyebrow: gold text
- `accentEyebrow`: change from `text-[#3b6ef0]` to `text-gold`
- `fieldClasses` focus: `focus:border-gold focus:ring-gold`
- `btnPrimary`: `bg-navy hover:bg-navy/90`
- `checkboxClasses` accent: `accent-gold`

**`app/layout.tsx`** — replace IBM Plex font import with Inter:

```tsx
import { Inter, JetBrains_Mono } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
```

Remove the IBM Plex Sans and IBM Plex Mono imports.

**Remove `ThemeToggle`** from the sidebar. The application is light-theme only for the MVP. The `[data-theme='dark']` token block in `main.css` can remain for future use but the toggle control should not be visible. Remove from `components/layout/Sidebar.tsx`.

The default `data-theme` in `app/layout.tsx` (or wherever `ThemeProvider` is configured) must be `light`.

---

### Step 4.1 — Sidebar and App Shell

Edit `components/layout/Sidebar.tsx` (you already edited this in Task 3):

- `aside` background: `bg-navy` (replacing `bg-surf3`)
- Border: `border-navy/20`
- Logo area border: `border-navy/20`
- Plan label: `text-gold` (replacing `text-[#3b6ef0]`)
- Active nav link: `bg-white/10 text-white` (light on dark navy)
- Inactive nav link: `text-white/60 hover:bg-white/10 hover:text-white`
- Section labels: `text-white/30`
- User name: `text-white/90`
- User role: `text-white/50`
- Avatar gradient: `from-navy to-gold`
- Sign out button: `text-white/40 hover:text-white`

`app/app/layout.tsx` — the main content area:
- `bg-bg text-t1` (existing token, renders as light in the `:root` token set — no change needed if the token is correctly set)

---

### Step 4.2 — Sign-in Page

`app/signin/[id]/page.tsx`:

- Two-panel layout: left panel = navy background with DARA logo, tagline, and gold accent; right panel = white/light background with the auth form.
- Remove any IBM Plex font references.
- Apply Inter via the `--font-sans` CSS variable (already set in `app/layout.tsx` after Step 4.0).
- Primary button: `bg-navy text-white hover:bg-navy/90`
- Focus rings: `ring-gold`

---

### Step 4.3 — Dashboard

`app/app/dashboard/page.tsx`:

- Stat cards: `bg-surf border border-line` (light surface). Stat value in `text-navy font-bold`. Label in `text-t4`.
- Solicitation table header: `bg-surf3 text-t4` text in navy.
- Plan panel: navy border-left accent (`border-l-4 border-navy`).
- P1/P2/P3 pass badges: keep existing pass status colors; they work on a light surface.
- "New Solicitation" button: `bg-navy text-white`.
- Page header: `text-navy` heading.
- Trial status bar (added in Task 1): gold left-border, `bg-gold/10`, `text-t2` text, "Upgrade" link in `text-navy font-semibold`.

---

### Step 4.4 — Solicitation List and New Solicitation

`app/app/solicitations/page.tsx`:
- Table header: `bg-surf3`.
- "New Solicitation" button: navy.
- Row hover: `hover:bg-surf2`.

`app/app/solicitations/new/page.tsx`:
- Card: `bg-surf border-line`.
- Submit button: navy.
- Labels and inputs: follow `theme.ts` tokens (updated in Step 4.0).

---

### Step 4.5 — Solicitation Detail Workspace

`app/app/solicitations/[id]/page.tsx` (the large file):

- Tab active state: gold underline (`border-b-2 border-gold text-navy font-semibold`). Inactive: `text-t4 hover:text-t2`.
- Compliance matrix table: `bg-surf` rows, `bg-surf3` header, `border-line` borders.
- `ReviewPassPanel`: pass card headers use pass type label in navy. Score badge: navy background or gold border. Findings severity badges: keep existing red/yellow/green severity colors — they render correctly on a light surface.
- CUI boundary modal: navy header, gold "I understand" button.
- Action buttons (Generate, Sync, Run Review): navy primary.

---

### Step 4.6 — Onboarding and Welcome

`app/onboarding/OnboardingWizard.tsx` (already simplified in Task 2):
- Step indicator dots: active = gold, completed = navy, future = `bg-line`.
- Primary button: navy.
- Card: `bg-surf border-line`.

`app/welcome/page.tsx`:
- Same pattern: navy heading, gold accent, navy primary button.

---

### Step 4.7 — Settings, Team, Company, Billing, Personas, Security, Account

Apply the same token-based pattern to each remaining page:

| Page | Key changes |
|------|------------|
| `app/app/settings/page.tsx` | Card headers in navy. Save button in navy. |
| `app/app/settings/CompanyAIConfig.tsx` | Mode toggle active state in gold. |
| `app/app/team/page.tsx`, `TeamView.tsx` | Table rows on `bg-surf`. Role badges keep existing colors. "Invite" button in navy. |
| `app/app/company/page.tsx` | Card surfaces `bg-surf`. Save button navy. |
| `app/app/billing/page.tsx` | Plan card selected state: navy border + gold accent. "Upgrade" button navy. Enterprise card: `border-line` only, contact-us link — **no Checkout Session created for Enterprise**. |
| `app/app/personas/page.tsx`, `PersonaManager.tsx` | Card `bg-surf`. Active badge gold. "Add Persona" button navy. |
| `app/app/security/page.tsx`, `security/plan/page.tsx` | Finding severity badges keep existing colors. Page header navy. |
| `app/account/page.tsx` | Card `bg-surf`. Save button navy. |

---

### Step 4.8 — Visual QA

After completing all pages, verify:

- [ ] No `text-[#3b6ef0]` or `bg-[#3b6ef0]` in any `/app` component (except color-team gate dots, which are intentional)
- [ ] No IBM Plex font rendered anywhere (`font-family` in DevTools shows Inter)
- [ ] Sidebar background is navy
- [ ] Gold accent on active nav items
- [ ] All primary buttons are navy
- [ ] Focus rings are gold
- [ ] Light background (`bg-bg` / `bg-surf`) on all content areas
- [ ] `ThemeToggle` not visible in the sidebar
- [ ] No dark-mode toggle accessible from the app shell

---

## TASK 5 — CUI Boundary Notice and AI Mode Copy

**Status:** `CuiBoundaryModal` exists; copy is outdated.
**PRD:** REQ-S-006, REQ-NF-011, REQ-UX-009.

### `components/dara/CuiBoundaryModal.tsx`

Update the modal copy for each AI mode. **Platform mode notice:**

> **Data Handling Notice**
>
> Your documents will be sent to Anthropic's API for processing. This connection uses standard commercial API terms. No Zero Data Retention (ZDR) agreement is in effect between this platform and Anthropic. Platform mode is not recommended for documents that contain Controlled Unclassified Information (CUI).
>
> If your documents may contain CUI, configure BYOK mode in Settings and use your own API key under a provider agreement that includes ZDR.

**BYOK mode notice:**

> **Data Handling Notice**
>
> Your documents will be sent to the AI provider you have configured using your own API key. The data handling terms of your provider agreement govern this connection. If you hold a Zero Data Retention agreement with your provider, this is the CMMC-compatible configuration path for CUI-containing documents.
>
> DARA does not serve as a ZDR counterparty. Your provider agreement is the controlling instrument.

The "I understand" button and the CUI indicator in the UI (`CuiBoundaryNotice.tsx`) should remain; only the modal copy changes.

### AI Mode Labels (Onboarding Step 2 and `CompanyAIConfig.tsx`)

Per REQ-UX-009, plain-language labels:

- **Platform mode:** "Platform AI — No API key required. Standard Anthropic commercial terms. Not recommended for CUI-containing documents."
- **BYOK mode:** "Bring Your Own Key (BYOK) — Use your own provider API key. Your provider agreement governs data handling. CMMC-compatible configuration path."

### Pre-Launch Copy Audit

Before marking Task 5 complete, search the entire codebase for the underlying review methodology name. It must not appear in:
- Any string in `utils/dara/prompt.ts`
- Any UI label, page title, tab name, or button text
- Any comment that would be visible in rendered output
- Any documentation string or placeholder

Zero instances are acceptable.

---

## TASK 6 — Image-Only PDF Failure Message

**Status:** Extraction failure returns a generic error.
**PRD:** REQ-F-006, REQ-UX-008.

In `utils/dara/documents.ts`, locate where `extractionStatus = 'failed'` is set on extraction failure.

In the UI (solicitation detail page, document upload area), when a `SolDocument` has `extractionStatus = 'failed'`, display:

> **Text extraction failed.** This file may be a scanned or image-based PDF without a text layer. Please re-upload a text-searchable PDF, or add requirements to the compliance matrix manually.

This must be a specific, actionable message — not "Upload failed" or a generic error toast.

---

## TASK 7 — In-App Documentation Page

**Status:** Exists but is minimal.
**PRD:** REQ-UX-011.

Locate the in-app documentation or help page. If it does not exist as a dedicated route, create `app/app/docs/page.tsx` and add a "Help" link to the sidebar under Account.

Populate with these five sections:

**1. How DARA Works**
Two deliverables. First: the compliance matrix — an AI-generated table of every requirement in your solicitation, classified by type and disposition. Second: the three-pass review — an AI evaluation of your proposal draft producing scored, severity-ranked findings with specific recommended actions.

**2. Supported File Formats**
RFP and proposal uploads accept PDF, DOCX, TXT, and MD files up to 20 MB. Files must be text-searchable. Scanned or image-only PDFs cannot be processed (no OCR). Re-upload a text-layer PDF or use a DOCX.

**3. The Three Review Passes**
- **Pass 1 — Compliance and Format:** evaluates your proposal against Section L instructions: document structure, page limits, required forms, section headers, and submission logistics.
- **Pass 2 — Technical Responsiveness:** evaluates your technical approach against the PWS/SOW tasks and Section M evaluation subfactors. Identifies factors with no corresponding proposal narrative.
- **Pass 3 — Risk and Competitive Positioning:** evaluates the proposal as a skeptical evaluator would — programmatic risks, competitive gaps, and sections likely to be scored below the competitive range.

Each pass produces a score (0–100) and severity-ranked findings (critical / high / medium / low). Each finding includes a requirement reference and a recommended action.

**4. Platform Mode vs. BYOK — CUI Handling**
Platform mode routes your documents through the platform's Anthropic API connection under standard commercial terms. No Zero Data Retention agreement is in effect. Platform mode is not recommended for documents containing CUI.

BYOK mode uses your own provider API key under your own provider agreement. If you hold a Zero Data Retention agreement with your provider, BYOK is the CMMC-compatible configuration path. Configure your key in Settings → AI Mode.

**5. Support**
[Contact support link — add the actual email or support URL here]

---

## TASK 8 — Enterprise Plan Guard

**Status:** Unverified.
**PRD:** REQ-F-022.

In `app/app/billing/page.tsx`, verify that the Enterprise plan card does **not** create a Stripe Checkout Session when clicked. It must display a "Contact us" link only (email or URL). No `createCheckoutSession` call for `enterprise`.

Search for `PLAN_CATALOG.enterprise` and `priceId: 'price_1Tm7kr...'` in the billing page. If a Checkout Session path exists for Enterprise, remove it and replace with a contact-us link.

---

## TASK 9 — Operator Configuration Actions

These are not code changes. Complete them in the listed order.

| # | Action | Where |
|---|--------|-------|
| 9.1 | Set platform AI model to `claude-sonnet-4-6` | `/app/admin` → Platform AI |
| 9.2 | Set `CRON_SECRET` in Vercel (all environments). The value can be any random 32+ char string. Redeploy after setting. | Vercel dashboard → Environment Variables |
| 9.3 | Verify `/api/cron/passes/route.ts` checks for `CRON_SECRET` bearer token. If `CRON_SECRET` is set in env, the route must return 401 for requests without the matching bearer token. Add this check if not already present. | `app/api/cron/passes/route.ts` |
| 9.4 | Set Supabase Auth Site URL to `https://dara.crucibleinsight.com`. Add redirect URLs: `https://dara.crucibleinsight.com/**` and `http://localhost:3000/**` | Supabase dashboard → Authentication → URL Configuration |
| 9.5 | Enable Confirm email in Supabase Auth settings | Supabase dashboard → Authentication → Settings |
| 9.6 | Configure custom SMTP sender (sender name: DARA, sender email: a verified address). Update the Invite user and Confirm signup email templates. | Supabase dashboard → Authentication → SMTP + Email Templates |
| 9.7 | Verify Stripe webhook is subscribed to: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Confirm the webhook URL has no trailing dot. | Stripe dashboard → Developers → Webhooks |
| 9.8 | Activate Customer Portal in Stripe | Stripe dashboard → Settings → Billing → Customer Portal |
| 9.9 | Enable branch protection on `main`: require gitleaks, lockfile, and CodeQL CI status checks before merge; block force-push and deletion of main. | GitHub → Repository Settings → Branch Protection Rules |
| 9.10 | Reconnect GitHub → Vercel integration for automatic deploys | Vercel dashboard → Project Settings → Git |
| 9.11 | Verify Supabase PITR (point-in-time recovery) is enabled. Confirm at least a 7-day recovery window. | Supabase dashboard → Settings → Backups |

---

## TASK 10 — Pre-Launch Quality Gates

Run these in order after all development tasks are complete.

### 10.1 — DARA-004 Isolation Test

```bash
npx tsx prisma/security/dara004-isolation-test.ts
```

Must pass 14/14. Zero failures are acceptable for launch.

### 10.2 — TypeScript and Build Check

```bash
pnpm exec tsc --noEmit
pnpm build
```

Both must complete without errors.

### 10.3 — CI Security Pipeline

Push to main. Verify the Security workflow passes: gitleaks secret scan, frozen lockfile verification, dependency audit, CodeQL. All must be green.

### 10.4 — Accessibility Audit

Run axe-core (or `npx @axe-core/cli`) against these pages in a browser:
- `/signin`
- `/onboarding`
- `/app/dashboard`
- `/app/solicitations`
- `/app/solicitations/[any-id]` (compliance tab)
- `/app/solicitations/[any-id]` (review tab)
- `/app/billing`

Zero WCAG 2.1 Level A or AA violations on primary interactive elements. Fix all violations before launch.

Also verify keyboard navigation: Tab moves through all interactive elements in logical order. Focus indicators are visible (gold ring).

### 10.5 — End-to-End Smoke Test

Execute this complete workflow manually in production:

1. Create a new account (email/password).
2. Complete three-step onboarding. Confirm dashboard reached.
3. Create a new solicitation (count: 1 of 2 in trial status bar).
4. Upload a text-searchable RFP PDF.
5. Click Generate Compliance Matrix. Wait for completion. Confirm requirements appear in matrix.
6. Edit one requirement's compliance status. Confirm save.
7. Export matrix to CSV. Confirm file downloads.
8. Export matrix to Word. Confirm file downloads.
9. Create a new review. Upload a proposal draft PDF.
10. Click Run Review. Confirm three passes execute (queued → running → complete). Confirm scores and findings render in `ReviewPassPanel`.
11. Click Sync from AI Review. Confirm Pass 1 findings appear in the matrix notes.
12. Re-run Pass 1. Confirm it executes independently and updates only Pass 1 results.
13. Navigate to `/app/billing`. Upgrade to Base plan via Stripe Checkout. Confirm `company.plan = 'starter'` in the DB. Confirm trial status bar disappears from dashboard.
14. Open Customer Portal from billing page. Confirm it loads.
15. Sign out. Sign back in. Confirm session restored correctly.

### 10.6 — Security Headers Inspection

```bash
curl -I https://dara.crucibleinsight.com/app/dashboard
```

Confirm these headers are present:
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Permissions-Policy`

### 10.7 — Trial Limit Test

1. On a trial account: attempt third solicitation → blocked with specific message.
2. Attempt fourth review run → Run button disabled, tooltip shows specific message.
3. Attempt third team invite → blocked with specific message.
4. After trial expiry (set `trialEndsAt` to the past in dev): any creation action → redirects to billing.
5. Export and view findings → always accessible regardless of limit state.

### 10.8 — Visual QA Checklist

Confirm on every `/app` page:
- [ ] Navy sidebar (`#1B2A4A`)
- [ ] Gold active nav indicator
- [ ] Inter font rendering (not IBM Plex)
- [ ] Light background on content areas
- [ ] No blue accent `#3b6ef0` visible in navigation, buttons, or form focus states (except color-team pipeline dots — intentional)
- [ ] `ThemeToggle` not present in sidebar
- [ ] Navy primary buttons on all primary CTA elements

### 10.9 — CUI Notice Review

Open `CuiBoundaryModal` in platform mode and in BYOK mode. Confirm:
- Platform mode copy accurately states no ZDR agreement and standard Anthropic commercial terms.
- BYOK mode copy accurately states the customer's own provider agreement governs.
- Neither notice misrepresents the data handling posture of either mode.
- The underlying review methodology name does not appear anywhere in either notice.

---

## Deploy Workflow (No Changes to This)

The existing deploy workflow is correct. Do not change it.

```bash
# Schema-only changes (if any):
pnpm prisma migrate deploy   # owner role / DIRECT_URL

# New dara_* table only (if any):
npx tsx prisma/security/apply-sql.ts prisma/security/<new>_rls.sql

# Deploy:
vercel deploy --prod --yes
git push

# After deploy — always:
# Hard-refresh the browser (Ctrl+Shift+R) before testing
# Run DARA-004 isolation test if any schema change was deployed
```

---

## Launch Readiness Checklist

All items must be confirmed before the production URL is shared publicly.

- [ ] Task 0: All production credentials rotated
- [ ] Task 1: Trial fencing implemented and tested (all resource types)
- [ ] Task 1: Trial status bar visible on dashboard for trial accounts
- [ ] Task 2: Onboarding wizard is 3 steps
- [ ] Task 3: Solicitation workspace shows 3-tab navigation
- [ ] Task 3: Sidebar shows correct 3 primary items
- [ ] Task 4: Navy/gold/Inter reskin complete on all /app pages
- [ ] Task 4: No blue accent in primary navigation (visual QA passed)
- [ ] Task 4: Inter font rendering confirmed
- [ ] Task 5: CUI boundary notice copy updated for both modes
- [ ] Task 5: AI mode labels use plain-language copy
- [ ] Task 5: Review methodology name absent from all user-facing output
- [ ] Task 6: Image-only PDF failure message is specific and actionable
- [ ] Task 7: In-app documentation page populated
- [ ] Task 8: Enterprise plan shows contact-us only (no Checkout Session)
- [ ] Task 9.1: Platform model set to `claude-sonnet-4-6`
- [ ] Task 9.2–9.3: `CRON_SECRET` set; worker route requires it
- [ ] Task 9.4–9.5: Supabase Auth Site URL and Confirm email configured
- [ ] Task 9.6: Supabase SMTP and email templates configured
- [ ] Task 9.7–9.8: Stripe webhook events confirmed; Customer Portal active
- [ ] Task 9.9: Branch protection on main enabled
- [ ] Task 9.11: Supabase PITR confirmed enabled
- [ ] Task 10.1: DARA-004 isolation test 14/14 on release build
- [ ] Task 10.2: TypeScript and build clean
- [ ] Task 10.3: CI security pipeline green
- [ ] Task 10.4: WCAG 2.1 AA — zero Level A or AA violations on primary workflows
- [ ] Task 10.5: End-to-end smoke test passed
- [ ] Task 10.6: Security headers confirmed on /app responses
- [ ] Task 10.7: Trial limit enforcement verified for all resource types
- [ ] Task 10.8: Visual QA passed — all /app pages
- [ ] Task 10.9: CUI notice copy reviewed and approved

---

## What Is Deferred (Do Not Build in This Sprint)

The following capabilities are implemented in the codebase and should remain accessible via the Advanced Pipeline view, but are not surfaced in the MVP primary navigation:

- **Amendments** (`app/app/solicitations/[id]/` — amendments tab, `utils/dara/amendments.ts`) — Phase 2
- **Department/team hierarchy** and solicitation-department scoping — Phase 2
- **Company CMMC/C3PAO profile fields** — accessible at `/app/company` but not in onboarding
- **Per-persona holistic evaluation** (`runEvaluation`, `ResultCard`) — legacy; preserved but collapsed under "Earlier per-reviewer findings"

The following are not in the codebase and are not built in this sprint:

- OCR for scanned PDFs
- GDPR account deletion path
- Consolidated HTML/PDF evaluation report
- Audit log viewer (company admin)
- Trial expiration notification emails
- JobQueue row purge cron
- CSP nonce hardening
- Enterprise self-serve Stripe Checkout
