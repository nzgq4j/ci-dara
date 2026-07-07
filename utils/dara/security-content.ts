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
  performed: 'June 27, 2026 · re-audited July 5, 2026',
  assessor: 'Internal security review (automated, evidence-based)',
  scope:
    'Application architecture, authn/z & tenant isolation, CUI/FCI data handling, secrets management, database & RLS, API & webhook security, AI/LLM data flow, file uploads, dependencies & supply chain, cloud/deployment configuration. The July 5, 2026 CMMC L2 re-audit re-examined the surface added since June — document/annotated-response exports, per-review uploads, personas as a review lens, and trial enforcement — and confirmed the prior remediations (DARA-001…019) remain intact with no regressions.',
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
  { family: 'Access Control', code: 'AC', status: 'Partial', note: 'Per-tenant RLS on all tenant tables under a least-privilege non-BYPASSRLS app role (company_id GUC per request); anon/authenticated REST access revoked; platform-admin via env allow-list (no source-embedded identities) with audited admin actions (DARA-010); deactivated accounts now fail closed across the app (DARA-026); app-layer companyId scoping retained as defense-in-depth. Remaining: a cross-department authorization gap on some child mutation actions (DARA-025) and a per-user platform-admin DB role for finer control.' },
  { family: 'Awareness & Training', code: 'AT', status: 'Not implemented', note: 'No security training program evidenced in the repository.' },
  { family: 'Audit & Accountability', code: 'AU', status: 'Partial', note: 'Append-only audit trail (dara_audit_log) records actor/action/target/time for security-relevant events (sign-in/provisioning, authz + BYOK-key changes, persona changes, CUI document/evaluation handling, billing). CUI export/egress paths — matrix/report exports, AI pass re-runs, and the annotated export — are now audited (DARA-024, DARA-030). Remaining: an admin-only, per-company audit viewer (planned under Team), a defined retention/review policy (DARA-041), and log review/alerting.' },
  { family: 'Configuration Management', code: 'CM', status: 'Partial', note: 'Good .gitignore; single pnpm lockfile (frozen in CI); CI security gates in place (secret scan, dependency audit, SAST, SBOM); tracked migration baseline + documented two-layer schema source of truth (DARA-017). Remaining: enable branch protection on main so the CI gates actually block deploys, which today run independently of the Vercel deploy (DARA-023), plus automated RLS-drift detection (DARA-035).' },
  { family: 'Identification & Authentication', code: 'IA', status: 'Partial', note: 'Supabase Auth with Google SSO (OAuth/PKCE) and email+password; "remember me" session controls; committed DB credential remediated (env, rotated, history-purged). MFA is available via the identity provider but not yet enforced in code or at the project level (DARA-031), and password policy/lockout needs verification (DARA-040) — both required for CMMC L2.' },
  { family: 'Incident Response', code: 'IR', status: 'Not implemented', note: 'No incident response plan evidenced.' },
  { family: 'Maintenance', code: 'MA', status: 'Undetermined', note: 'No maintenance procedure evidenced in the repository.' },
  { family: 'Media Protection', code: 'MP', status: 'Partial', note: 'BYOK keys and CUI extracted text both encrypted at rest (AES-256-GCM; DARA-009); private storage bucket; solicitation delete now removes all stored CUI blobs, no longer orphaning files (DARA-027). Remaining: a formal media sanitization/retention policy and a tenant-level right-to-delete / CUI purge (DARA-043).' },
  { family: 'Personnel Security', code: 'PS', status: 'Not applicable', note: 'Organizational process; not assessable from the repository.' },
  { family: 'Physical Protection', code: 'PE', status: 'Not applicable', note: 'Inherited from cloud providers (Vercel / Supabase / AWS).' },
  { family: 'Risk Assessment', code: 'RA', status: 'Partial', note: 'This assessment performed; automated dependency audit + CodeQL SAST run in CI on every push/PR. Remaining: continuous/runtime vulnerability scanning and a recurring risk-assessment cadence.' },
  { family: 'Security Assessment & Monitoring', code: 'CA', status: 'Partial', note: 'Point-in-time review plus per-push CI scanning (secret, dependency, SAST). A System Security Plan is documented in-app (/app/security/plan). Remaining: continuous runtime monitoring and alerting.' },
  { family: 'System & Communications Protection', code: 'SC', status: 'Partial', note: 'Platform TLS; security headers + CSP; DB TLS enforced (DARA-014); CUI encrypted at rest (DARA-009). CUI→LLM egress: commercial endpoints retained with compensating controls — boundary notices, BYOK option, per-run audit (DARA-007, risk accepted); zero-data-retention agreements on platform keys pursued offline. Remaining (SC-5): no application-layer rate limiting / WAF (DARA-021) and a decompression-bomb guard on document extraction (DARA-032); a nonce-based CSP to drop unsafe-inline (DARA-033).' },
  { family: 'System & Information Integrity', code: 'SI', status: 'Partial', note: 'LLM input fenced (incl. the annotated-export path, DARA-024); React output escaping sound; automated dependency audit + CodeQL SAST in CI. Remaining: Next.js 14.2.35 now carries unpatched high-severity advisories (SSRF, middleware bypass) requiring a 14→15 upgrade (DARA-022), and a latent dangerouslySetInnerHTML sink to remove (DARA-038).' },
  { family: 'Planning', code: 'PL', status: 'Partial', note: 'System Security Plan drafted as a living in-app document (/app/security/plan) mapping implemented controls to NIST families, with the findings register serving as the POA&M. Remaining: formal sign-off and a maintenance cadence.' },
  { family: 'Supply Chain Risk Management', code: 'SR', status: 'Partial', note: 'Frozen pnpm lockfile, high-severity dependency audit, and a CycloneDX SBOM generated in CI. Remaining: scan the SBOM + add a license gate rather than only generating it (DARA-037), SHA-pin third-party GitHub Actions (DARA-036), and artifact provenance/signing.' }
];

// ── System Security Plan (SSP) — living document; see /app/security/plan ─────────
export const SSP = {
  version: 'Draft 0.2',
  updated: 'July 5, 2026',
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
    status: 'Remediated',
    component: 'prisma/migrations · prisma/security/*.sql',
    evidence: 'Read-only introspection (2026-06-29) confirmed production is clean: exactly the 12 dara_* tables, no legacy/template tables, no auth.users trigger, no template functions. schema.prisma matches the live DB with zero drift. A baseline migration (prisma/migrations/0_init) was generated and marked applied (migrate resolve); migrate status reports the schema up to date. The owner-only security DDL (RLS/grants/roles/audit triggers) is tracked as an ordered manifest in prisma/security/*.sql.',
    impact: 'Resolved. Schema changes now have a tracked, auditable baseline and a documented two-layer source of truth (Prisma migrations for table structure + owner-SQL for security DDL). The legacy-drift concern was already eliminated by earlier work and is verified gone.',
    remediation: 'Completed: database baselined (prisma/migrations/0_init), forward workflow is migrate dev/deploy (no db push), and the model is documented in prisma/security/DARA-017-migrations.md + prisma/migrations/README.md.',
    mapping: 'NIST CM-2, CM-3, CM-6',
    window: 'Closed'
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
  },

  // ── July 5, 2026 CMMC L2 re-audit (DARA-021…043; net-new surface since June) ─────
  // The prior remediations (DARA-001…019) remain intact with no regressions. The items
  // below cover attack surface added since June (document/annotated exports, per-review
  // uploads, personas-as-review-lens, trial enforcement) plus best-practice hardening.
  {
    id: 'DARA-021',
    title: 'No application rate limiting or abuse protection',
    severity: 'High',
    status: 'Open',
    component: 'Vercel WAF / app endpoints (AI-run, export, upload, auth)',
    evidence: 'No WAF, BotID, Firewall/Attack Mode, or app-level rate limits are configured (vercel.json defines only the cron). Expensive authenticated endpoints are unbounded per tenant: the annotated-export route (live LLM call), review/pass re-runs (the trial meter fires only on the first run), report/matrix exports, and uploads. On non-trial (paid) plans the trial meter short-circuits entirely, so AI egress and spend are unmetered.',
    impact: 'A single authenticated tenant can drive unbounded LLM cost and load (denial-of-wallet / DoS). No cross-tenant exposure.',
    remediation: 'Add Vercel WAF rate-limit rules (or an edge/Upstash limiter) on AI-run, export, upload, and auth paths; BotID on auth; a per-tenant AI call/cost budget or re-run throttle.',
    mapping: 'NIST SC-5 · OWASP A10 / LLM04 · CMMC L2',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-022',
    title: 'Next.js 14.2.35 carries unpatched high-severity advisories',
    severity: 'High',
    status: 'Open',
    component: 'package.json · next@14.2.35',
    evidence: 'pnpm audit --prod flags multiple HIGH advisories for the 14.x line — SSRF (GHSA-c4j6-fc7j-m34r), middleware/proxy authorization bypass (GHSA-3g8h-86w9-wvmq), and RSC denial-of-service. All fixes are on the 15.x line; 14.2.x will not receive them.',
    impact: 'The production framework has known SSRF and middleware-bypass advisories with no available patch on the current major version.',
    remediation: 'Plan and execute a Next.js 14 → 15 migration with regression testing, then track the patched line.',
    mapping: 'NIST SA-10/11, SR-3, SI-2 · OWASP A06',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-023',
    title: 'CI security gates do not block production deploys',
    severity: 'Moderate',
    status: 'Open',
    component: 'GitHub branch protection · Vercel deploy trigger',
    evidence: 'Branch protection on main is not enforced, and Vercel deploys on git push independently of GitHub Actions, so a red Security/CodeQL check does not stop a production deploy. The CI gates (DARA-015) are informational today.',
    impact: 'A change that fails secret-scanning, dependency audit, or SAST can still reach production.',
    remediation: 'Enable branch protection requiring the Security + CodeQL status checks and blocking force-push/deletion on main; gate the Vercel prod deploy on CI (ignored-build-step tied to CI, or deployment protection).',
    mapping: 'NIST CM-3, SA-10, SR-4 · OWASP A05',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-024',
    title: 'Annotated-export CUI→LLM egress unaudited and unfenced',
    severity: 'High',
    status: 'Remediated',
    component: 'app/app/solicitations/[id]/annotated · utils/dara/annotated-proposal.ts',
    evidence: 'The annotated-proposal export sends the full decrypted proposal to the commercial LLM to anchor findings. It now records an annotated.export audit entry (provider/mode/reviewId) at the egress and wraps the proposal in the shared randomized fence + injection guard, matching every other prompt builder and the DARA-007 audit premise.',
    impact: 'Resolved. The only previously-unaudited CUI→LLM egress is now on the audit trail and fenced like the rest.',
    remediation: 'Completed (commit 7fe23ab): recordAudit at the egress + fenceUntrusted/INJECTION_GUARD on the proposal text.',
    mapping: 'NIST AU-2, AU-3 · OWASP LLM01 · DARA-007',
    window: 'Closed'
  },
  {
    id: 'DARA-025',
    title: 'Cross-department authorization gap on child mutation/delete actions',
    severity: 'High',
    status: 'Remediated',
    component: 'app/app/solicitations/[id] server actions',
    evidence: 'Department-scoped access (app-layer; DB RLS is company-level) is enforced on the solicitation-detail gate, but several child mutate/delete actions authorized the child by companyId only. Every such action now (a) runs requireViewableSolicitation on the parent solId and (b) ties the child to that solId — the local-fetch actions (requirement update/save/delete, sol-document/review/review-document/amendment delete, review update) scope their findFirst by solicitationId; the delegating actions (run/re-run/regenerate/archive/apply-change/reconcile) call a shared requireChildInSol that resolves review/pass/result/amendment/change up to solId before the helper runs.',
    impact: 'Resolved. A reviewer or out-of-department member can no longer tamper with, delete, or trigger AI runs on another department’s data by pairing a viewable solId with a guessable sibling child id.',
    remediation: 'Completed (this session): requireViewableSolicitation + solId-scoped child resolution on all child mutation/delete actions; requireChildInSol helper for the delegating (run/regenerate/reconcile) actions.',
    mapping: 'NIST AC-3, AC-6 · OWASP API1/A01 (BOLA)',
    window: 'Closed'
  },
  {
    id: 'DARA-026',
    title: 'Deactivated users retained application access',
    severity: 'High',
    status: 'Remediated',
    component: 'utils/dara/provision.ts · getDaraUser',
    evidence: 'getDaraUser now returns null when is_active is false, failing closed across server actions and route handlers (not just the page shell) and independent of the best-effort Supabase auth ban. The app-shell layout uses a separate raw lookup so a deactivated user still reaches the terminal “account disabled” screen.',
    impact: 'Resolved. A banned/deactivated account loses all application access immediately, regardless of whether the identity-provider ban succeeded.',
    remediation: 'Completed (this session): fail-closed is_active check centralized in getDaraUser; findDaraUserRaw reserved for the disabled-screen path.',
    mapping: 'NIST AC-2, IA-4',
    window: 'Closed'
  },
  {
    id: 'DARA-027',
    title: 'Solicitation delete orphaned CUI files in storage',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'app/app/solicitations/page.tsx · deleteSolicitationAction',
    evidence: 'Deleting a solicitation cascaded the DB rows but never removed the stored blobs, leaving uploaded RFP/proposal/amendment files and per-review response drafts (full CUI) in the private bucket with no DB pointer. The action now gathers every SolDocument and ReviewDocument storedFilename before the cascade and removeStored()s them; the audit entry records the count.',
    impact: 'Resolved. No orphaned CUI objects remain after a solicitation is deleted.',
    remediation: 'Completed (this session): collect + removeStored all stored files on solicitation delete.',
    mapping: 'NIST MP-6, SI-12',
    window: 'Closed'
  },
  {
    id: 'DARA-028',
    title: 'CSV formula / DDE injection in compliance-matrix export',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'app/app/solicitations/[id] · exportMatrixAction (CSV)',
    evidence: 'CSV cell escaping previously only doubled quotes, so AI-shredded requirement text (derived from attacker-supplied solicitation docs) beginning with = + - @ or a control char could execute as a formula/DDE in a reviewer’s spreadsheet. Cells starting with a trigger character are now prefixed with a single quote before RFC-4180 quoting. (The DOCX export is unaffected.)',
    impact: 'Resolved. Exported matrix CSVs can no longer inject formulas into Excel / Google Sheets.',
    remediation: 'Completed (this session): formula-injection neutralization added to the CSV escaper.',
    mapping: 'OWASP A03 · CWE-1236',
    window: 'Closed'
  },
  {
    id: 'DARA-029',
    title: 'No encryption key-rotation / rewrap path',
    severity: 'Moderate',
    status: 'Open',
    component: 'utils/dara/crypto.ts',
    evidence: 'The data key is derived as a bare SHA-256(APP_KEY); the v1: prefix versions the envelope format, not the key. Rotating APP_KEY would render all existing ciphertext (BYOK provider keys and every encrypted extracted_text) undecryptable — there is no key-id tag and no re-encrypt migration.',
    impact: 'Key rotation is effectively impossible without data loss, weakening incident response for a suspected APP_KEY compromise.',
    remediation: 'Add a key-id to the crypto envelope plus a rewrap/re-encrypt migration before rotation is needed; optionally move from bare SHA-256 to scrypt/HKDF-with-salt.',
    mapping: 'NIST SC-12, SC-28',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-030',
    title: 'Audit coverage gaps for new CUI egress and exports',
    severity: 'Moderate',
    status: 'Remediated',
    component: 'exportMatrixAction · report/pdf route · rerunPassAction',
    evidence: 'Beyond the annotated export (DARA-024), several CUI egress/export paths emitted no audit record. Added recordAudit to the compliance-matrix export (CSV/DOCX), the analysis-report PDF export, and single-pass re-runs (a full CUI→LLM pass) — action + entity + non-CUI metadata only.',
    impact: 'Resolved. All identified CUI export/egress paths now write an audit record.',
    remediation: 'Completed (this session): matrix.export, report.export, and review.pass.rerun audit events added.',
    mapping: 'NIST AU-2, AU-3',
    window: 'Closed'
  },
  {
    id: 'DARA-031',
    title: 'Multi-factor authentication (TOTP 2FA)',
    severity: 'High',
    status: 'In progress',
    component: 'Supabase Auth MFA · /app/account/security · /auth/2fa-challenge · middleware',
    evidence: 'TOTP two-factor is implemented on Supabase Auth native MFA (AAL2). Users opt in at /app/account/security (QR enrollment; works with Google/Microsoft Authenticator, Authy, etc.); a login-time challenge (/auth/2fa-challenge) elevates the session to AAL2, and middleware gates every /app (CUI) route on AAL2. Ten single-use backup codes are bcrypt-hashed at rest and shown once; a signed httpOnly recovery marker covers the backup-code path. Enroll/challenge/disable are audited (mfa.enable/challenge/disable). The TOTP secret is stored by Supabase — never by us.',
    impact: 'Users can now protect CUI access with a second factor. Residual: MFA is opt-in, not yet mandatory tenant-wide, and turning on the Supabase project TOTP factor is an operator step.',
    remediation: 'Done (this session): in-app opt-in TOTP + AAL2 gate on /app + bcrypt backup codes + audit. Remaining (operator/policy): enable the TOTP factor in the Supabase project, then move from opt-in to enforced (require enrollment for all CUI users; optional app-side “must enroll” gate).',
    mapping: 'NIST 800-171 03.05.03 · IA-2 · CMMC L2',
    window: 'In progress — opt-in shipped; enforcement is operator/policy'
  },
  {
    id: 'DARA-032',
    title: 'No decompression-bomb guard in document extraction',
    severity: 'Moderate',
    status: 'Open',
    component: 'utils/dara/documents.ts · extractText',
    evidence: 'assertValidUpload caps input at 20 MB with magic-byte checks, but .docx (ZIP → mammoth) and PDF (unpdf) are parsed with no decompression-ratio or output-size limit — a crafted 20 MB file can inflate to gigabytes and exhaust function memory during extraction.',
    impact: 'A single malicious upload can OOM/DoS the extraction function.',
    remediation: 'Bound the decompressed and extracted-text size during extraction; abort past a threshold.',
    mapping: 'NIST SC-5 · OWASP A05',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-033',
    title: 'CSP allows unsafe-inline (no nonce)',
    severity: 'Low',
    status: 'Open',
    component: 'next.config.js',
    evidence: "script-src/style-src include 'unsafe-inline' and img-src is broad (https:). This is the previously-deferred nonce hardening first noted under DARA-011.",
    impact: 'Reduced defense-in-depth against a future injection; not an active vulnerability on its own.',
    remediation: 'Move to a nonce-based script-src to drop unsafe-inline.',
    mapping: 'NIST SC-18 · OWASP A05',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-034',
    title: 'Cron worker fail-open when CRON_SECRET unset',
    severity: 'Low',
    status: 'Remediated',
    component: 'app/api/cron/passes/route.ts',
    evidence: 'The pass worker previously allowed unauthenticated calls whenever CRON_SECRET was unset. It now requires the bearer in production (returns 500 if the secret ever drifts out of the env) while staying optional outside production; triggerWorker forwards the same bearer for legitimate in-request continuations.',
    impact: 'Resolved. In production the long-budget, CUI-processing worker cannot be invoked without the shared secret.',
    remediation: 'Completed (this session): CRON_SECRET is mandatory in production.',
    mapping: 'NIST AC-3',
    window: 'Closed'
  },
  {
    id: 'DARA-035',
    title: 'No automated RLS-drift / isolation check in CI',
    severity: 'Low',
    status: 'Open',
    component: 'CI · prisma/security',
    evidence: 'RLS policies and grants are applied by hand-run scripts with no automated coverage check, and the two-tenant isolation harness (dara004-isolation-test.ts) is not run in CI. A new dara_* table shipped without its RLS file would not be caught automatically.',
    impact: 'Risk of undetected RLS drift as the schema grows.',
    remediation: 'Add a CI check that verifies pg_policies/grants for every @@map("dara_*") model and runs the isolation harness against an ephemeral database.',
    mapping: 'NIST CM-3, CM-6',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-036',
    title: 'Third-party GitHub Actions pinned to mutable tags',
    severity: 'Low',
    status: 'Open',
    component: '.github/workflows',
    evidence: 'Third-party actions (gitleaks, anchore/sbom-action) are referenced by mutable tags rather than full commit SHAs, so an upstream tag move could alter CI behavior.',
    impact: 'Supply-chain risk in the CI pipeline.',
    remediation: 'Pin third-party actions to full commit SHAs.',
    mapping: 'NIST SR-3, SR-4',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-037',
    title: 'SBOM generated but not scanned or license-gated',
    severity: 'Low',
    status: 'Open',
    component: 'CI (CycloneDX SBOM)',
    evidence: 'A CycloneDX SBOM is produced each CI run (DARA-015) but never consumed — no vulnerability scan (e.g. Grype) and no license allow/deny gate act on it.',
    impact: 'Dependency vulnerabilities and disallowed licenses are not surfaced or enforced.',
    remediation: 'Scan the SBOM in CI and add a license policy gate.',
    mapping: 'NIST SR-3, SA-15',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-038',
    title: 'Latent dangerouslySetInnerHTML in report page',
    severity: 'Low',
    status: 'Open',
    component: 'app/app/solicitations/[id]/report/page.tsx',
    evidence: 'A dangerouslySetInnerHTML sink currently renders only static string literals, but it is an XSS footgun and contradicts the “no dangerous rendering sinks” self-assessment.',
    impact: 'No active vulnerability today; a future edit feeding it dynamic data would introduce XSS.',
    remediation: 'Replace the sink with a plain text node.',
    mapping: 'OWASP A03',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-039',
    title: 'Raw provider/webhook error text surfaced to clients',
    severity: 'Low',
    status: 'Open',
    component: 'utils/dara/passes.ts (failPass) · app/api/webhooks',
    evidence: 'Failure paths store/return raw messages — failPass persists the AI provider’s e.message and the webhook returns "Webhook Error: ${msg}" — which can leak internal detail.',
    impact: 'Information disclosure via error messages.',
    remediation: 'Return generic client-facing errors and log the detail server-side only.',
    mapping: 'OWASP A05',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-040',
    title: 'Password policy and brute-force lockout unverified',
    severity: 'Low',
    status: 'Open',
    component: 'Supabase Auth (project config)',
    evidence: 'Minimum length (8+), HIBP/leaked-password protection, and auth rate limits are not confirmed from the project config; password.trim() silently strips edge whitespace before submission.',
    impact: 'Weak or leaked passwords may be accepted, and auth endpoints may lack lockout.',
    remediation: 'Verify/enforce Supabase password minimums, leaked-password protection, and auth rate limits.',
    mapping: 'NIST IA-5, AC-7',
    window: 'Short-term (8–30 days) — operator'
  },
  {
    id: 'DARA-041',
    title: 'No audit-log retention or review policy',
    severity: 'Low',
    status: 'Open',
    component: 'dara_audit_log · governance',
    evidence: 'The append-only audit log has strong integrity but no defined retention period / purge-partition (unbounded growth) and no documented AU-6 review cadence (who reads it, when).',
    impact: 'Unbounded log growth and no defined log-review process.',
    remediation: 'Define a retention period + purge/partition strategy and an AU-6 review cadence.',
    mapping: 'NIST AU-6, AU-11',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-042',
    title: 'Persona system prompts injected at system-instruction trust level',
    severity: 'Low',
    status: 'Open',
    component: 'utils/dara/personas.ts · prompt.ts',
    evidence: 'Persona.systemPrompt (tenant-admin authored) is injected into the review prompts as a lens with a soft “must not override” framing. It is company-scoped, so the worst case is self-inflicted bias.',
    impact: 'A company admin could bias their own reviews; no cross-tenant impact.',
    remediation: 'Document the trust boundary; optionally constrain persona guidance to tone/emphasis or move it out of the system role.',
    mapping: 'OWASP LLM01',
    window: 'Best practice'
  },
  {
    id: 'DARA-043',
    title: 'No tenant/account right-to-delete (CUI purge)',
    severity: 'Low',
    status: 'Open',
    component: 'Account lifecycle',
    evidence: 'There is no company-level purge of all CUI (documents, findings, storage). Already tracked as the GDPR account-deletion backlog item.',
    impact: 'A tenant data-deletion request cannot be fully honored today.',
    remediation: 'Build a company-scoped purge of all CUI across the database and storage.',
    mapping: 'NIST MP-6 · data minimization',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-044',
    title: 'Company-configurable document retention / archive limits',
    severity: 'Low',
    status: 'Open',
    component: 'Company settings · dara_sol_documents / dara_review_documents · storage',
    evidence: 'Uploaded solicitation/proposal/amendment documents and per-review response drafts (CUI) are retained indefinitely; there is no per-company policy to auto-archive or delete documents after a configurable age, so CUI accumulates well beyond its useful life.',
    impact: 'CUI is retained longer than necessary (data-minimization gap): a larger blast radius on compromise and more to purge on a right-to-delete request.',
    remediation: 'Add a per-company retention/archive setting (e.g. auto-delete documents + stored blobs older than N days/months, with an opt-in archive-then-purge window). Enforce via a scheduled job that removeStored()s expired files and audits each purge. Complements DARA-041 (audit retention) and DARA-043 (tenant right-to-delete).',
    mapping: 'NIST SI-12, MP-6, AU-11 · data minimization',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-045',
    title: 'Code-owned transactional email — invites unreliable on built-in email',
    severity: 'Moderate',
    status: 'Open',
    component: 'Supabase Auth email · utils/dara/teams.ts (sendInvitationEmail) · (future) mailer',
    evidence: 'Confirmed 2026-07-06: team invitations do not reliably send on Supabase’s built-in email. inviteUserByEmail fails with "email rate limit exceeded" (the shared sender caps at a few messages/hour) and with "A user with this email address has already been registered" when re-sending to an address that a prior invite already registered — so Resend cannot re-email an existing invitee. The link side is fixed (the token_hash /auth/confirm flow shipped), so once delivery works, invite links complete → onboarding. Auth emails are also unbranded and send from a shared sender (no custom-domain SPF/DKIM/DMARC).',
    impact: 'Team invitations and resends often never reach the recipient, so onboarding cannot start. Workaround: the invitation row is the source of truth, so an invitee can still join by signing in. Unbranded shared-sender mail is also weaker against spoofing/phishing and spam-filtering.',
    remediation: 'Implement code-owned email via Resend (or Custom SMTP): mint links with admin.generateLink (type=invite for new users, type=magiclink for existing) and send our own branded email — works for first-invites AND resends, no rate cap. Requires RESEND_API_KEY + a verified crucibleinsight.com from-domain (SPF/DKIM/DMARC). Interim stopgap: enable Custom SMTP in Supabase (raises the rate cap) — but it still can’t re-send to an already-registered address, so the generateLink path is the real fix. Cover invite + confirm-signup.',
    mapping: 'NIST SI-8 · SPF/DKIM/DMARC email authentication · availability / product',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-046',
    title: 'Password reset is broken — recovery link fails to verify',
    severity: 'High',
    status: 'Remediated',
    component: 'utils/auth-helpers/server.ts (requestPasswordUpdate) · app/auth/confirm/route.ts · supabase/templates/recovery.html',
    evidence: 'Password reset was triggered by supabase.auth.resetPasswordForEmail on the PKCE SSR client, so the built-in recovery email’s {{ .TokenHash }} rendered as a PKCE code (token_hash=pkce_…). The template links to /auth/confirm?token_hash=…&type=recovery, and /auth/confirm calls verifyOtp({type, token_hash}) — but a pkce_ token is not a verifiable OTP hash; it needs exchangeCodeForSession plus the code-verifier cookie from the originating browser (absent when opened from an email scanner like Outlook SafeLinks or another device), so verifyOtp failed and the route redirected to /signin. Nobody could reset their password.',
    impact: 'Resolved. requestPasswordUpdate (and sign-up confirmation, same root cause) now fire from a shared implicit-flow supabase-js client, so {{ .TokenHash }} is a plain OTP hash that /auth/confirm verifies server-side, cross-device — the same token_hash path the invite flow already uses successfully.',
    remediation: 'Completed (this session): a shared newImplicitAuthClient() (anon key, flowType:"implicit", no session persistence) now backs both resetPasswordForEmail and signUp instead of the default PKCE SSR client, so their token_hash confirmation links (recovery + confirmation.html type=signup) verify cross-device. No new env/infra; still uses Supabase’s built-in (Resend-SMTP) email. Note: recovery/confirmation links generated before this fix remain dead — request a fresh one. Magic-link (signInWithEmail) + email-change (updateEmail) still run on the PKCE SSR client and would share the defect if their templates use the token_hash link — not yet exercised/changed.',
    mapping: 'NIST IA-5 (authenticator management) · availability',
    window: 'Closed'
  }
];

export const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Moderate', 'Low', 'Informational'];

export const POSITIVES: string[] = [
  'A July 2026 re-audit confirmed the prior remediations (DARA-001…019) hold with no regressions: all 26 tenant tables carry per-tenant RLS + least-privilege grants, and every data path added since June (exports, annotated export, per-review uploads) routes through the tenant transaction.',
  'Application-layer tenant scoping by companyId is applied consistently; no live cross-tenant (IDOR) query was found in the application data plane.',
  'No LLM tool/function calling is configured, which limits the blast radius of prompt injection to output manipulation.',
  'No client-exposed secrets; only public keys carry the NEXT_PUBLIC_ prefix.',
  'CSRF posture is adequate: state changes use Next.js Server Actions and the Stripe webhook verifies its signature.',
  'React output escaping is relied on throughout and no eval is used; the single dangerouslySetInnerHTML sink renders only static literals and is slated for removal (DARA-038).',
  'BYOK provider keys are encrypted at rest with AES-256-GCM (random IV + auth tag).'
];
