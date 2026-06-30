// DARA-010: the platform-admin allow-list is configured ONLY via the
// PLATFORM_ADMIN_EMAILS env var (comma-separated). No source-embedded fallback —
// if the var is unset there are zero env-pinned admins (fail-closed), and a warning
// is logged. This list is the bootstrap root for Application Admins: env-listed
// emails are auto-provisioned into dara_platform_admins and cannot be removed
// in-app. The DB-aware resolver + guard live in utils/dara/platform.ts.
export function platformAdminEmails(): string[] {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) {
    console.warn(
      '[admin] PLATFORM_ADMIN_EMAILS is unset — no platform admins are configured.'
    );
  }
  return list;
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().includes(email.toLowerCase());
}
