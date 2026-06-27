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
  { family: 'Access Control', code: 'AC', status: 'Partial', note: 'Consistent app-layer tenant scoping by companyId; no database RLS; platform-admin via email allow-list.' },
  { family: 'Awareness & Training', code: 'AT', status: 'Not implemented', note: 'No security training program evidenced in the repository.' },
  { family: 'Audit & Accountability', code: 'AU', status: 'Not implemented', note: 'No database audit logging; most mutations record no actor.' },
  { family: 'Configuration Management', code: 'CM', status: 'Partial', note: 'Good .gitignore; dual lockfiles, no migration history, no CI security gates.' },
  { family: 'Identification & Authentication', code: 'IA', status: 'Partial', note: 'Supabase Auth; committed DB credential remediated (moved to env, rotated, purged from history); MFA posture Unverified.' },
  { family: 'Incident Response', code: 'IR', status: 'Not implemented', note: 'No incident response plan evidenced.' },
  { family: 'Maintenance', code: 'MA', status: 'Undetermined', note: 'No maintenance procedure evidenced in the repository.' },
  { family: 'Media Protection', code: 'MP', status: 'Partial', note: 'BYOK keys encrypted (AES-256-GCM); CUI extracted text stored in plaintext; best-effort deletion.' },
  { family: 'Personnel Security', code: 'PS', status: 'Not applicable', note: 'Organizational process; not assessable from the repository.' },
  { family: 'Physical Protection', code: 'PE', status: 'Not applicable', note: 'Inherited from cloud providers (Vercel / Supabase / AWS).' },
  { family: 'Risk Assessment', code: 'RA', status: 'Partial', note: 'This assessment performed; no continuous vulnerability scanning.' },
  { family: 'Security Assessment & Monitoring', code: 'CA', status: 'Partial', note: 'Point-in-time review; no continuous monitoring program.' },
  { family: 'System & Communications Protection', code: 'SC', status: 'Partial', note: 'Platform TLS; DB TLS not explicitly enforced; no security headers/CSP; CUI egress to LLM APIs.' },
  { family: 'System & Information Integrity', code: 'SI', status: 'Partial', note: 'Outdated Next.js; LLM input not delimited; React output escaping is sound.' },
  { family: 'Planning', code: 'PL', status: 'Not implemented', note: 'No System Security Plan (SSP) evidenced.' },
  { family: 'Supply Chain Risk Management', code: 'SR', status: 'Partial', note: 'Lockfiles present; no SBOM, dependency scanning, or provenance controls.' }
];

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
    status: 'Open',
    component: '.env.local (gitignored, on disk)',
    evidence: 'Live Stripe secret/webhook keys, Supabase service-role JWT, platform Anthropic key, APP_KEY, DB password. Correctly untracked.',
    impact: 'Broad blast radius if the workstation, a backup, or a malicious dependency reads the working tree.',
    remediation: 'Keep runtime secrets in the platform secret store only; rotate on suspicion; minimize live keys on local disk.',
    mapping: 'NIST IA-5, SC-12 · OWASP A07',
    window: 'Immediate (0–7 days)'
  },
  {
    id: 'DARA-003',
    title: 'No Row-Level Security on application (tenant) tables',
    severity: 'High',
    status: 'Open',
    component: 'Postgres schema (dara_* tables)',
    evidence: 'RLS policies exist only for legacy template tables; none for any dara_* table. Schema applied via prisma db push.',
    impact: 'Tenant isolation depends solely on application code; a single omitted filter exposes cross-tenant CUI with no database backstop.',
    remediation: 'Enable deny-by-default RLS on all dara_* tables keyed on company_id, set per request, paired with a least-privilege role.',
    mapping: 'NIST AC-3, AC-4, SC-2 · OWASP API1 (BOLA)',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-004',
    title: 'Application connects with an RLS-bypassing database role',
    severity: 'High',
    status: 'Open',
    component: 'utils/prisma.ts:17 · connection string',
    evidence: 'Runtime connects as the Supabase project-owner role (BYPASSRLS), which nullifies any RLS even if added.',
    impact: 'Defense-in-depth from RLS cannot take effect; leaked credentials grant unrestricted access.',
    remediation: 'Create a dedicated non-superuser application role with DML-only grants on dara_* tables; reserve the owner role for migrations.',
    mapping: 'NIST AC-6, AC-3 · OWASP API8',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-005',
    title: 'Potential anon-key REST exposure of tenant tables (verify live)',
    severity: 'High',
    status: 'Open',
    component: 'Supabase PostgREST · public anon key',
    evidence: 'The browser anon key reaches the same database; if default grants on the public schema remain and RLS is absent, dara_* tables may be readable via REST. Unverified from repo.',
    impact: 'Possible full cross-tenant CUI disclosure bypassing all application checks.',
    remediation: 'REVOKE anon/authenticated privileges on dara_* (or enable RLS) and verify with a live anon-key request against /rest/v1/dara_*.',
    mapping: 'NIST AC-3, AC-4 · OWASP A01',
    window: 'Immediate (0–7 days) — verify'
  },
  {
    id: 'DARA-006',
    title: 'Outdated framework and dependencies with known CVEs',
    severity: 'High',
    status: 'Open',
    component: 'package.json · Next.js 14.2.3 + ~40 advisories',
    evidence: 'Next.js 14.2.3 predates the CVE-2025-29927 middleware auth-bypass fix; dependency audit reports 1 critical / many high. Per-page re-auth mitigates the middleware bypass for data access.',
    impact: 'Known-vulnerable components in production; elevated exploitation risk over time.',
    remediation: 'Upgrade Next.js to a patched release, run a dependency upgrade pass, and add automated dependency scanning.',
    mapping: 'NIST SI-2, RA-5 · OWASP A06',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-007',
    title: 'CUI transmitted to commercial LLM APIs',
    severity: 'High',
    status: 'Open',
    component: 'utils/dara/providers.ts',
    evidence: 'Extracted proposal/solicitation text is sent to Anthropic/OpenAI/Google; platform-key mode sends under the vendor account. Retention terms Unverified.',
    impact: 'CUI may leave the protected boundary into third-party services without a verified covered agreement or zero-retention configuration.',
    remediation: 'Establish data-handling terms / zero-retention, prefer BYOK or gov-authorized endpoints for CUI, and surface a boundary notice.',
    mapping: 'NIST SC-7, AC-4 · OWASP LLM06',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-008',
    title: 'Prompt injection via untrusted document and persona text',
    severity: 'High',
    status: 'Open',
    component: 'utils/dara/prompt.ts · evaluator.ts',
    evidence: 'Attacker-controlled document text is concatenated into model prompts with no delimiting or instruction isolation; persona prompts are free text.',
    impact: 'Evaluation scoring (used for award decisions) can be manipulated by an offeror embedding instructions in a proposal.',
    remediation: 'Fence untrusted text in randomized delimiters, instruct the model to treat it as data, and validate output. No tool-calling is configured (limits blast radius).',
    mapping: 'NIST SI-10 · OWASP LLM01',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-009',
    title: 'CUI extracted text stored in plaintext at rest',
    severity: 'High',
    status: 'Open',
    component: 'dara_sol_documents / dara_response_files',
    evidence: 'extracted_text columns persist full proposal/solicitation content in plaintext.',
    impact: 'CUI is readable to anyone with database access; increases the impact of DARA-001/003/004/005.',
    remediation: 'Encrypt extracted text at the application layer (as with BYOK keys) or rely on verified storage encryption plus strict access control.',
    mapping: 'NIST SC-28, MP-4',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-010',
    title: 'Platform-admin authorization via hardcoded email allow-list',
    severity: 'Moderate',
    status: 'Open',
    component: 'utils/dara/admin.ts:6',
    evidence: 'Cross-tenant super-admin gated by email membership with a hardcoded fallback list (including a personal address).',
    impact: 'God-mode authority hinges on an email string and a source-embedded default.',
    remediation: 'Drive platform-admin from a server-side role/claim, remove the hardcoded fallback, require verified email, and audit admin actions.',
    mapping: 'NIST AC-2, AC-6 · OWASP API5 (BFLA)',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-011',
    title: 'No security response headers (CSP, HSTS, X-Frame-Options)',
    severity: 'Moderate',
    status: 'Open',
    component: 'next.config.js · middleware.ts',
    evidence: 'No headers() block or middleware sets CSP, HSTS, frame-ancestors, nosniff, or Referrer-Policy.',
    impact: 'No clickjacking protection, no CSP to blunt future XSS, no transport hardening.',
    remediation: 'Add a strict header set (CSP, HSTS, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).',
    mapping: 'NIST SC-7, SC-8 · OWASP A05',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-012',
    title: 'No server-side file type/size validation on uploads',
    severity: 'Moderate',
    status: 'Open',
    component: 'utils/dara/documents.ts',
    evidence: 'Arbitrary buffers stored; client-supplied MIME trusted; extension-only switch; no explicit size limit. Filenames are sanitized (no traversal).',
    impact: 'Storage abuse and unexpected content into the CUI store; parser DoS on crafted archives.',
    remediation: 'Enforce server-side extension + magic-byte allow-list, an explicit max size, and server-derived content type.',
    mapping: 'NIST SI-10 · OWASP A04/A05',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-013',
    title: 'No database-layer audit logging',
    severity: 'Moderate',
    status: 'Open',
    component: 'Database schema',
    evidence: 'No audit/event table or DML triggers; most mutations record no actor or timestamp of change.',
    impact: 'No accountability or forensic trail for CUI access and changes — a direct CMMC/AU gap.',
    remediation: 'Add an append-only audit trail (actor, company_id, action, target, time) via triggers or pgaudit.',
    mapping: 'NIST AU-2, AU-3, AU-12',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-014',
    title: 'DB connection TLS not explicitly enforced',
    severity: 'Moderate',
    status: 'Open',
    component: 'connection strings · utils/prisma.ts:17',
    evidence: 'No sslmode in connection strings and no ssl option on the adapter. On-wire enforcement Unverified.',
    impact: 'Risk of unencrypted or downgraded database sessions carrying CUI and credentials.',
    remediation: 'Require TLS (sslmode=require or verify-full with CA) on all database connections.',
    mapping: 'NIST SC-8, SC-13',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-015',
    title: 'No CI/CD security gates',
    severity: 'Moderate',
    status: 'Open',
    component: 'Repository (no CI workflows)',
    evidence: 'No secret scanning, SAST, dependency review, SBOM, or branch protection evidenced.',
    impact: 'Class of issues like DARA-001 are not caught automatically; no supply-chain assurance.',
    remediation: 'Add secret scanning, dependency audit and SAST gates, SBOM generation, and branch protection.',
    mapping: 'NIST CA-7, RA-5, SR-3 · OWASP A05',
    window: 'Short-term (8–30 days)'
  },
  {
    id: 'DARA-016',
    title: 'Dual package lockfiles',
    severity: 'Low',
    status: 'Open',
    component: 'package-lock.json + pnpm-lock.yaml',
    evidence: 'Both lockfiles present; build resolves via pnpm. Currently consistent but a drift/repro risk.',
    impact: 'Ambiguous, potentially divergent dependency resolution across environments.',
    remediation: 'Standardize on one package manager; remove the other lockfile; enforce a frozen lockfile in CI.',
    mapping: 'NIST CM-2, SR-3/4',
    window: 'Mid-term (31–90 days)'
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
    status: 'Open',
    component: 'app/auth/callback/route.ts',
    evidence: 'redirect_to is concatenated onto the app origin; absolute/protocol-relative values stay on-host today, but the value is not validated.',
    impact: 'Fragile redirect handling that could regress into an open redirect.',
    remediation: 'Validate redirect_to as a single-slash relative path; reject // and backslashes.',
    mapping: 'NIST SC-7 · OWASP A01 · CWE-601',
    window: 'Mid-term (31–90 days)'
  },
  {
    id: 'DARA-019',
    title: 'Encryption helper tolerates plaintext fallback',
    severity: 'Low',
    status: 'Open',
    component: 'utils/dara/crypto.ts:22',
    evidence: 'AES-256-GCM construction is sound; decrypt returns raw input when the v1: prefix is absent, and key strength depends on APP_KEY entropy.',
    impact: 'An unmigrated/plaintext value would be used silently; weak APP_KEY weakens the derived key.',
    remediation: 'Remove the plaintext fallback once migrated; enforce a high-entropy APP_KEY.',
    mapping: 'NIST SC-12, SC-28',
    window: 'Mid-term (31–90 days)'
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
