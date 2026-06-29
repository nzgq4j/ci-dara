// Single source of truth for the in-app Security & Compliance page
// (app/app/security/page.tsx). Standards + control posture are shown to all
// authenticated users; the detailed findings register is gated to platform
// admins in the page. No secret values are stored here.

export type Severity = 'Critical' | 'High' | 'Moderate' | 'Low' | 'Informational';
export type ControlStatus =
  | 'Implemented'
  | 'Partial'
  | 'Not implemented'
  | 'Not applicable'
  | 'Undetermined';
export type FindingStatus = 'Open' | 'In progress' | 'Remediated' | 'Risk accepted';

export interface Framework {
  code: string;
  name: string;
  summary: string;
  scope: string;
}

export interface ControlPosture {
  family: string;
  code: string;
  status: ControlStatus;
  note: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  component: string;
  evidence: string;
  impact: string;
  remediation: string;
  mapping: string;
  window: string;
}

export const ASSESSMENT = {
  title: 'DARA Cybersecurity Assessment',
  performed: 'June 27, 2026',
  assessor: 'Internal security review (automated, evidence-based)',
  scope:
    'Application architecture, authn/z & tenant isolation, CUI/FCI data handling, secrets management, database & RLS, API & webhook security, AI/LLM data flow, file uploads, dependencies & supply chain, cloud/deployment configuration.',
  method:
    'Read-only static review of the repository, configuration, and dependency tree. No exploit code was run against production or third-party services. Every control is rated by repository evidence only; items not determinable from the repo are marked Undetermined.',
  evidenceStandard:
    'Findings cite file paths and line references. Configuration and governance items that cannot be confirmed from the repository are explicitly marked Unverified rather than assumed compliant.'
};

export const FRAMEWORKS: Framework[] = [
  {
    code: 'NIST SP 800-171 Rev. 3',
    name: 'Protecting CUI in Nonfederal Systems',
    summary:
      'The baseline requirements for safeguarding Controlled Unclassified Information on contractor systems.',
    scope: 'Primary control baseline'
  },
  {
    code: 'NIST SP 800-171A Rev. 3',
    name: 'Assessing Security Requirements for CUI',
    summary: 'The assessment procedures used to evaluate each 800-171 requirement.',
    scope: 'Assessment methodology'
  },
  {
    code: 'NIST SP 800-53 Rev. 5',
    name: 'Security and Privacy Controls',
    summary:
      'The comprehensive control catalog from which 800-171 derives; used for control mapping.',
    scope: 'Reference control catalog'
  },
  {
    code: 'NIST CSF 2.0',
    name: 'Cybersecurity Framework',
    summary:
      'Outcome-based functions — Govern, Identify, Protect, Detect, Respond, Recover.',
    scope: 'Program-level alignment'
  },
  {
    code: 'CMMC 2.0 (Level 2)',
    name: '32 CFR Part 170',
    summary:
      'DoD certification model; Level 2 mirrors the 110 requirements of NIST SP 800-171.',
    scope: 'Readiness target'
  },
  {
    code: 'OWASP',
    name: 'ASVS · Top 10 · API Top 10 · LLM Top 10',
    summary:
      'Application, API, and LLM security verification standards used for code-level review.',
    scope: 'Secure-coding standard'
  },
  {
    code: 'CIS Benchmarks',
    name: 'Cloud & Platform Hardening',
    summary: 'Provider hardening guidance for cloud and platform configuration.',
    scope: 'Configuration baseline'
  }
];

export const CONTROL_POSTURE: ControlPosture[] = [
  { family: 'Access Control', code: 'AC', status: 'Partial', note: 'Per-tenant RLS on all tenant tables under a least-privilege non-BYPASSRLS app role (company_id GUC per request); anon/authenticated REST access revoked; platform-admin via env allow-list (no source-embedded identities) with audited admin actions (DARA-010); app-layer companyId scoping retained as defense-in-depth. Remaining: a per-user platform-admin DB role for finer control.' },
  { family: 'Awareness & Training', code: 'AT', status: 'Not implemented', note: 'No security training program evidenced in the repository.' },
  { family: 'Audit & Accountability', code: 'AU', status: 'Partial', note: 'Append-only audit trail (dara_audit_log) records actor/action/target/time for security-relevant events (sign-in/provisioning, authz + BYOK-key changes, persona changes, CUI document/evaluation handling, billing). Remaining: an admin-only, per-company audit viewer (planned under Team), a retention policy, and log review/alerting.' },
  { family: 'Configuration Management', code: 'CM', status: 'Partial', note: 'Good .gitignore; single pnpm lockfile (frozen in CI); CI security gates in place (secret scan, dependency audit, SAST, SBOM). Remaining: tracked migration history (DARA-017) and enabling branch protection on main.' },
  { family: 'Identification & Authentication', code: 'IA', status: 'Partial', note: 'Supabase Auth with Google SSO (OAuth/PKCE) and email+password; "remember me" session controls; committed DB credential remediated (env, rotated, history-purged). MFA available via the identity provider; org-level enforcement Unverified.' },
  { family: 'Incident Response', code: 'IR', status: 'Not implemented', note: 'No incident response plan evidenced.' },
  { family: 'Maintenance', code: 'MA', status: 'Undetermined', note: 'No maintenance procedure evidenced in the repository.' },
  { family: 'Media Protection', code: 'MP', status: 'Partial', note: 'BYOK keys and CUI extracted text both encrypted at rest (AES-256-GCM; DARA-009); private storage bucket; best-effort deletion. Remaining: a formal media sanitization/retention policy.' },
  { family: 'Personnel Security', code: 'PS', status: 'Not applicable', note: 'Organizational process; not assessable from the repository.' },
  { family: 'Physical Protection', code: 'PE', status: 'Not applicable', note: 'Inherited from cloud providers (Vercel / Supabase / AWS).' },
  { family: 'Risk Assessment', code: 'RA', status: 'Partial', note: 'This assessment performed; automated dependency audit + CodeQL SAST run in CI on every push/PR. Remaining: continuous/runtime vulnerability scanning and a recurring risk-assessment cadence.' },
  { family: 'Security Assessment & Monitoring', code: 'CA', status: 'Partial', note: 'Point-in-time review plus per-push CI scanning (secret, dependency, SAST). A System Security Plan is documented in-app (/app/security/plan). Remaining: continuous runtime monitoring and alerting.' },
  { family: 'System & Communications Protection', code: 'SC', status: 'Partial', note: 'Platform TLS; security headers + CSP; DB TLS enforced (DARA-014); CUI encrypted at rest (DARA-009). CUI→LLM egress: commercial endpoints retained with compensating controls — boundary notices, BYOK option, per-run audit (DARA-007, risk accepted); zero-data-retention agreements on platform keys pursued offline.' },
  { family: 'System & Information Integrity', code: 'SI', status: 'Partial', note: 'Next.js patched to 14.2.35; LLM input fenced; React output escaping sound; automated dependency audit + CodeQL SAST in CI. Remaining: triage of dev-only transitive advisories.' },
  { family: 'Planning', code: 'PL', status: 'Partial', note: 'System Security Plan drafted as a living in-app document (/app/security/plan) mapping implemented controls to NIST families, with the findings register serving as the POA&M. Remaining: formal sign-off and a maintenance cadence.' },
  { family: 'Supply Chain Risk Management', code: 'SR', status: 'Partial', note: 'Frozen pnpm lockfile, high-severity dependency audit, and a CycloneDX SBOM generated in CI. Remaining: artifact provenance/signing.' }
];

// ── System Security Plan (SSP) — living document; see /app/security/plan ─────────
export const SSP = {
  version: 'Draft 0.1',
  updated: 'June 28, 2026',
  owner: 'Crucible Insight LLC',
  system: 'DARA — Document Analysis & Response Assistant',
  overview:
    'DARA is a multi-tenant SaaS that performs AI-assisted evaluation of government solicitations and offeror proposals. It ingests solicitation and proposal documents (which may contain FCI/CUI), extracts their text, and scores responses against user-defined criteria using configurable AI personas. Each company is an isolated tenant; users have role-based access. The plan below reflects the controls as implemented; the findings register is the Plan of Action & Milestones (POA&M).',
  dataCategories: [
    'FCI / CUI — solicitation and proposal document content (extracted text) and evaluation results.',
    'Authentication identifiers — names, emails, roles (Supabase Auth / Google SSO).',
    'Secrets — customer BYOK provider API keys (encrypted at rest).',
    'Billing — Stripe customer / subscription identifiers (no CUI).'
  ],
  boundary: [
    { component: 'Vercel', role: 'App hosting & serverless functions (Next.js)', data: 'Processes requests in transit; no persistent CUI storage.' },
    { component: 'Supabase Postgres', role: 'Primary database (Prisma)', data: 'Tenant data incl. CUI extracted_text, encrypted at rest; per-tenant RLS.' },
    { component: 'Supabase Auth', role: 'Authentication / SSO', data: 'User identities and sessions.' },
    { component: 'Supabase Storage', role: 'Private document bucket', data: 'Uploaded solicitation / proposal files.' },
    { component: 'LLM provider (Anthropic / OpenAI / Google)', role: 'AI evaluation', data: 'Receives document text at evaluation time (DARA-007; commercial endpoints, BYOK / ZDR).' },
    { component: 'Stripe', role: 'Payments', data: 'Billing identifiers only; no CUI.' }
  ],
  roles: [
    { role: 'Platform admin', who: 'Crucible Insight operators (env allow-list)', responsibility: 'Cross-tenant administration; all actions audited; no source-embedded identities.' },
    { role: 'Company admin', who: 'Customer organization administrator', responsibility: 'Manage company users/roles, AI configuration & BYOK keys, billing.' },
    { role: 'Manager / Reviewer', who: 'Customer users', responsibility: 'Create and run evaluations, or view results, per assigned role.' }
  ]
};

export const FINDINGS: Finding[] = [
  {
    id: 'DARA-001',
    title: 'Live database credential committed to version control',
    severity: 'Critical',
    status: 'Remediated',
    component: 'prisma.config.ts',
    evidence: 'Datasource URL now loaded from environment variables (DIRECT_URL); the hardcoded password was removed from source, the database password was rotated, and the credential was purged from git history (history rewrite + force-push). Repository is private.',
    impact:
      'Resolved. The previously committed credential is rotated (now invalid) and no longer present in the working tree or git history.',
    remediation:
      'Completed: credential removed from source and loaded from env, database password rotated, and prior values scrubbed from git history. Residual: GitHub may retain unreachable objects by exact SHA until its own GC — harmless given rotation.',
    mapping: 'NIST IA-5, AC-3, SC-28 · OWASP A05/A07 · CMMC L2',
    window: 'Closed'
  },
  {
    id: 'DARA-002',
    title: 'Live production secrets present in local environment file',
    severity: 'High',
    status: 'Remediated',
    component: '.env.local (gitignored, on disk)',
    evidence: 'Vercel is the authoritative secret store (all runtime secrets present there). Local files never tracked (gitignore verified; only the secret-free .env.example is committed). Redundant duplicate .env removed; two dead secrets (STRIPE_PRICING_TABLE_ID, CRON_SECRET) trimmed from .env.local; accurate secret-free template restored. Documented in prisma/security/DARA-002-secrets.md.',
    impact: 'Resolved for persistent divergence: the platform store is the source of truth and local files are a regenerable mirror. Residual: live keys still touch disk during local dev (risk-accepted) — bounded by gitignore + the rotation-on-suspicion runbook + DARA-004 least-privilege roles.',
    remediation: 'Completed: platform-as-source-of-truth model documented, on-disk copies minimized, rotation-on-suspicion runbook recorded (DARA-002-secrets.md; BUILD_STATUS §4 #9). Residual local-disk presence risk-accepted with compensating controls.',
    mapping: 'NIST IA-5, SC-12 · OWASP A07',
    window: 'Closed'
  },
  {
    id: 'DARA-003',
    title: 'No Row-Level Security on application (tenant) tables',
    severity: 'High',
    status: 'Remediated',
    component: 'Postgres schema (dara_* tables)',
    evidence: 'Per-tenant RLS policies are deployed on all 11 dara_* tables, keyed on company_id (id for dara_companies) against a per-request app.company_id GUC set inside each transaction via withTenant(). Verified by a two-tenant isolation harness (14/14: cross-tenant read/update/delete/insert all blocked, unscoped queries fail-closed to zero rows) and live in production.',
    impact: 'Resolved. The database enforces tenant isolation independently of application code; a missing scope returns zero rows rather than another tenant’s data. App-layer companyId scoping is retained as defense-in-depth.',
    remediation: 'Completed: per-tenant policies deployed (prisma/security/2026-06-27_dara004_rls_policies.sql) and the app runs under the non-BYPASSRLS dara_app role (closed together with DARA-004).',
    mapping: 'NIST AC-3, AC-4, SC-2 · OWASP API1 (BOLA)',
    window: 'Closed'
  },
  {
    id: 'DARA-004',
    title: 'Application connects with an RLS-bypassing database role',
    severity: 'High',
    status: 'Remediated',
    component: 'utils/prisma.ts · withTenant / prismaTenant / prismaAdmin',
    evidence: 'Runtime now connects as the least-privilege dara_app role (NOT BYPASSRLS, DML-only on dara_*) through withTenant(), which sets the per-request app.company_id GUC. The three audited cross-tenant paths (provisioning, Stripe webhook, platform admin) use a separate dara_admin role; the owner role is reserved for migrations only. Production hard-fails if the role connection strings are missing (no silent owner fallback).',
    impact: 'Resolved. RLS is now effective; a leaked application credential is confined by RLS and cannot alter schema. Verified in production and by the two-tenant isolation harness.',
    remediation: 'Completed: three-role least-privilege model deployed (prisma/security/2026-06-27_dara004_rls_policies.sql; see DARA-004-handoff.md).',
    mapping: 'NIST AC-6, AC-3, AC-5 · OWASP API8',
    window: 'Closed'
  },
  {
    id: 'DARA-005',
    title: 'Anon-key REST exposure of tenant tables (confirmed, then closed)',
    severity: 'Critical',
    status: 'Remediated',
    component: 'Supabase PostgREST · public anon key',
    evidence: 'Confirmed live: the public anon key had full CRUD on all dara_* tables via PostgREST (HTTP 200 with rows). Remediated by revoking all anon/authenticated privileges and enabling RLS; re-probe now returns HTTP 401 (42501 permission denied). Future grants blocked via default privileges.',
    impact: 'Resolved. The public anon key can no longer read or modify tenant data via the REST API.',
    remediation: 'Completed: privileges revoked, RLS enabled, default privileges locked (see prisma/security/2026-06-27_lock_dara_tables.sql).',
    mapping: 'NIST AC-3, AC-4 · OWASP A01 (BOLA)',
    window: 'Closed'
  },
  {
    id: 'DARA-006',
    title: 'Outdated framework and dependencies with known CVEs',
    severity: 'High',
    status: 'In progress',
    component: 'package.json · Next.js (now 14.2.35)',
    evidence: 'Next.js upgraded 14.2.3 -> 14.2.35, clearing CVE-2025-29927 (middleware auth-bypass) and the other 14.2.x advisories (cache poisoning, image-optimization, SSRF-via-redirect). Remaining audit advisories are dev-only transitive deps (supabase CLI: tar/minimatch/glob) not shipped to production.',
    impact: 'Production framework is patched. Residual risk is limited to local/dev tooling.',
    remediation: 'Done: Next.js patched. Remaining: bump dev tooling (supabase CLI) and add automated dependency scanning (see DARA-015).',
    mapping: 'NIST SI-2, RA-5 · OWASP A06',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-007',
    title: 'CUI transmitted to commercial LLM APIs',
    severity: 'High',
    status: 'Risk accepted',
    component: 'utils/dara/providers.ts',
    evidence: 'Decision: retain the commercial-LLM hosting model; accept the residual risk with compensating controls. Controls in place: explicit CUI data-boundary notice at every egress/config point (Documents + Offerors tabs, AI settings); BYOK offered as the option for customers to use their own provider terms; CUI encrypted at rest (DARA-009) and in transit (TLS, DARA-014); each evaluation run audits the provider/mode the CUI was sent to (DARA-013); data flow documented (prisma/security/DARA-007-data-boundary.md).',
    impact: 'Residual risk surfaced and accepted. Commercial endpoints remain non-FedRAMP; recommended posture for live CUI is BYOK and/or zero-data-retention agreements on the platform keys.',
    remediation: 'Compensating controls shipped. Pending (offline contract action): execute zero-data-retention (ZDR) agreements on the platform keys (Anthropic ZDR + DPA; OpenAI ZDR on approval; Google paid/Vertex ZDR). On signing, update the boundary notice to state platform-mode ZDR.',
    mapping: 'NIST SC-7, AC-4 · OWASP LLM06',
    window: 'Accepted (revisit on ZDR signing)'
  },
  {
    id: 'DARA-008',
    title: 'Prompt injection via untrusted document and persona text',
    severity: 'High',
    status: 'In progress',
    component: 'utils/dara/prompt.ts · evaluator.ts',
    evidence: 'Proposal and solicitation text are now wrapped in randomized per-call fences (<<UNTRUSTED-…:token>>) with a security-notice instruction telling the model to treat fenced content as data, not instructions. Numeric score/confidence are already clamped on parse. No tool-calling is configured (limits blast radius).',
    impact: 'Substantially reduced: an offeror embedding "set score to 100" is fenced and flagged. Persona system prompts (company-admin authored, semi-trusted) are not yet constrained.',
    remediation: 'Done: document/solicitation fencing + data-not-instructions guard. Remaining: constrain/validate persona system prompts and add an output sanity check.',
    mapping: 'NIST SI-10 · OWASP LLM01',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-009',
    title: 'CUI extracted text stored in plaintext at rest',
    severity: 'High',
    status: 'Remediated',
    component: 'dara_sol_documents / dara_response_files',
    evidence: 'extracted_text is encrypted at the application layer (AES-256-GCM, same envelope as BYOK keys): encrypted on write (documents.ts) and decrypted at point of use in the evaluator (decryptField). Existing rows were backfill-encrypted (0 plaintext remaining) and a live production evaluation confirmed correct end-to-end decryption.',
    impact: 'Resolved. Proposal/solicitation CUI is no longer readable from the database without APP_KEY.',
    remediation: 'Completed: app-layer encryption + idempotent backfill (prisma/security/backfill-dara009-encrypt-extracted-text.ts). Future: rotate APP_KEY with re-encryption tooling.',
    mapping: 'NIST SC-28, MP-4',
    window: 'Closed'
  },
  {
    id: 'DARA-010',
    title: 'Platform-admin authorization via hardcoded email allow-list',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'utils/dara/admin.ts',
    evidence: 'Source-embedded fallback admin list (incl. a personal address) removed. Platform admins are now configured only via the PLATFORM_ADMIN_EMAILS env var, fail-closed (zero admins + a warning if unset). Admin actions are audited (DARA-013, admin.* events); email verification is enforced by Supabase sign-in.',
    impact: 'Resolved. No admin identity is embedded in source; the allow-list is server-side config, fail-closed, and every admin action is attributable.',
    remediation: 'Completed: env-only allow-list + audit. Future hardening: a per-user is_platform_admin DB flag for finer, UI-managed control.',
    mapping: 'NIST AC-2, AC-6 · OWASP API5 (BFLA)',
    window: 'Closed'
  },
  {
    id: 'DARA-011',
    title: 'No security response headers (CSP, HSTS, X-Frame-Options)',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'next.config.js',
    evidence: 'Added a global security header set via next.config.js headers(): Content-Security-Policy (default-src self; object-src/frame-ancestors none; scoped connect-src for Supabase/Stripe), Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy.',
    impact: 'Resolved. Clickjacking blocked, transport hardened, and a CSP now constrains script/connect origins. A nonce-based CSP (removing script-src unsafe-inline) is a future hardening step.',
    remediation: 'Completed via next.config.js. Future: migrate to nonce-based CSP to drop unsafe-inline on scripts.',
    mapping: 'NIST SC-7, SC-8 · OWASP A05',
    window: 'Closed'
  },
  {
    id: 'DARA-012',
    title: 'No server-side file type/size validation on uploads',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'utils/dara/documents.ts',
    evidence: 'uploadAndExtract now enforces a server-side allow-list (PDF/DOCX/TXT/MD), a 20 MB max size, and magic-byte checks (PDF %PDF-, DOCX PK\\x03\\x04). Storage content type is derived server-side from the extension, not the client File.type.',
    impact: 'Resolved. Spoofed-type and oversized uploads are rejected before storage; filenames remain sanitized (no traversal).',
    remediation: 'Completed in utils/dara/documents.ts.',
    mapping: 'NIST SI-10 · OWASP A04/A05',
    window: 'Closed'
  },
  {
    id: 'DARA-013',
    title: 'No database-layer audit logging',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'dara_audit_log · utils/dara/audit.ts',
    evidence: 'Append-only audit trail (dara_audit_log: actor, company, action, target, metadata, time) written via the privileged client; grants are SELECT/INSERT-only (no UPDATE/DELETE) and RLS denies the app role. Instrumented across the security-relevant events: user provisioning, AI-config + BYOK-key changes, member/role changes, platform-admin company/user changes, subscription sync, document & response-file upload/delete, evaluation runs, and solicitation/offeror create/delete.',
    impact: 'Resolved for the security-relevant surface. Forensic trail now exists for CUI handling and privileged changes.',
    remediation: 'Completed: app-layer audit trail (prisma/security/2026-06-28_dara013_audit_log.sql). Future: extend to fine-grained criteria/persona/field edits and sign-in events; add a retention/export policy and an in-app viewer.',
    mapping: 'NIST AU-2, AU-3, AU-12',
    window: 'Closed'
  },
  {
    id: 'DARA-014',
    title: 'DB connection TLS not explicitly enforced',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'utils/prisma.ts · pg adapter ssl',
    evidence: 'Both runtime DB clients construct the pg driver adapter with ssl enabled (sslmode=require equivalent). Verified by the isolation harness connecting to the pooler over TLS.',
    impact: 'Resolved. Database sessions carrying CUI and credentials are encrypted in transit.',
    remediation: 'Completed: ssl enforced on the tenant and admin clients. verify-full (bundled Supabase CA) is a future hardening.',
    mapping: 'NIST SC-8, SC-13',
    window: 'Closed'
  },
  {
    id: 'DARA-015',
    title: 'No CI/CD security gates',
    severity: 'Moderate',
    status: 'Remediated',
    component: '.github/workflows/',
    evidence: 'CI gates on push/PR to main: gitleaks secret scanning (full history), pnpm frozen-lockfile install + high-severity dependency audit, CodeQL SAST (security-and-quality), and a CycloneDX SBOM (Syft) uploaded as a build artifact.',
    impact: 'Issues like DARA-001 (committed secret) and DARA-016 (lockfile drift) are caught automatically; a supply-chain SBOM is produced each run.',
    remediation: 'Completed: secret scan, dependency audit, SAST, frozen-lockfile gate, SBOM. Enforcement requires enabling branch protection on main (require these status checks + block force-push/deletion) — a one-time repo setting documented in BUILD_STATUS §4.',
    mapping: 'NIST CA-7, RA-5, SR-3 · OWASP A05',
    window: 'Closed'
  },
  {
    id: 'DARA-016',
    title: 'Dual package lockfiles',
    severity: 'Low',
    status: 'Remediated',
    component: 'package.json (packageManager: pnpm)',
    evidence: 'package-lock.json removed and gitignored; pnpm declared via the packageManager field; CI enforces pnpm install --frozen-lockfile.',
    impact: 'Resolved. A single authoritative lockfile (pnpm) governs dependency resolution everywhere.',
    remediation: 'Completed: standardized on pnpm; npm lockfile removed; frozen-lockfile gate in CI (DARA-015).',
    mapping: 'NIST CM-2, SR-3/4',
    window: 'Closed'
  },
  {
    id: 'DARA-017',
    title: 'No migration history; legacy template schema drift',
    severity: 'Low',
    status: 'Open',
    component: 'prisma db push · legacy SQL',
    evidence: 'Empty migrations directory; legacy template tables and an auth.users signup trigger coexist with the Prisma schema.',
    impact: 'No schema change audit/rollback; two schemas of record with divergent RLS posture.',
    remediation: 'Adopt tracked migrations; remove or formally own legacy objects; document the single source of truth.',
    mapping: 'NIST CM-2, CM-3, CM-6',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-018',
    title: 'Borderline open redirect in auth callback',
    severity: 'Low',
    status: 'Remediated',
    component: 'app/auth/callback/route.ts',
    evidence: 'redirect_to is validated as a single-slash-rooted relative path; absolute URLs, protocol-relative //host, and backslashes are rejected and fall back to /app/dashboard.',
    impact: 'Resolved. The callback cannot be coerced into an off-host redirect.',
    remediation: 'Completed: safeRelativePath() guard applied to redirect_to.',
    mapping: 'NIST SC-7 · OWASP A01 · CWE-601',
    window: 'Closed'
  },
  {
    id: 'DARA-019',
    title: 'Encryption helper tolerates plaintext fallback',
    severity: 'Low',
    status: 'Remediated',
    component: 'utils/dara/crypto.ts',
    evidence: 'decryptSecret no longer returns plaintext for non-v1 input (returns empty), so an unmigrated/plaintext value is never silently used. APP_KEY entropy is checked with a loud startup warning if it is missing or under 32 chars.',
    impact: 'Resolved. Only authenticated AES-256-GCM ciphertext is accepted; a weak APP_KEY is surfaced.',
    remediation: 'Completed: plaintext fallback removed; APP_KEY strength warning added.',
    mapping: 'NIST SC-12, SC-28',
    window: 'Closed'
  },
  {
    id: 'DARA-020',
    title: 'Storage bucket privacy and object-key hardening unverified',
    severity: 'Low',
    status: 'Open',
    component: 'Supabase Storage (dara-documents)',
    evidence: 'Service-role-only access; predictable companyId-embedded keys; no signed URLs; bucket privacy asserted but not enforced in repo.',
    impact: 'No defense-in-depth if the bucket is ever misconfigured public or the service key leaks.',
    remediation: 'Confirm the bucket is private, add storage policies, and use short-lived signed URLs if files become downloadable.',
    mapping: 'NIST AC-3, SC-28 · OWASP API1',
    window: 'Mid-term (31–90 days)'
  }
];

export const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Moderate', 'Low', 'Informational'];

export const POSITIVES: string[] = [
  'Application-layer tenant scoping by companyId is applied consistently; no live cross-tenant (IDOR) query was found in the application data plane.',
  'No LLM tool/function calling is configured, which limits the blast radius of prompt injection to output manipulation.',
  'No client-exposed secrets; only public keys carry the NEXT_PUBLIC_ prefix.',
  'CSRF posture is adequate: state changes use Next.js Server Actions and the Stripe webhook verifies its signature.',
  'No dangerous rendering sinks (no dangerouslySetInnerHTML / eval); React output escaping is relied on throughout.',
  'BYOK provider keys are encrypted at rest with AES-256-GCM (random IV + auth tag).'
];
