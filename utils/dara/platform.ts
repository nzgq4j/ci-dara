import { redirect } from 'next/navigation';
import { createClient as createServerClient } from '@/utils/supabase/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { prismaAdmin } from '@/utils/prisma';
import { isPlatformAdmin } from '@/utils/dara/admin';
import { recordAudit } from '@/utils/dara/audit';
import type { PlatformAdmin } from '@prisma/client';

// ── Application (platform) admins ───────────────────────────────────────────────
// Company-less operator accounts: manage backend/platform settings and users, with
// NO access to company CUI (they have no tenant context). Identity is keyed by email
// (so an admin can be granted before first sign-in) and bootstrapped from the
// PLATFORM_ADMIN_EMAILS allow-list. All reads/writes go through prismaAdmin
// (dara_admin); the tenant runtime role has no grant on dara_platform_admins.

// Lazy service-role client for Supabase Auth admin ops (ban / delete users).
let _authAdmin: SupabaseClient | null = null;
function authAdmin(): SupabaseClient {
  if (!_authAdmin) {
    _authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _authAdmin;
}

/**
 * Resolve the platform-admin record for an email, or null if the account is not an
 * application admin. Env-listed admins are auto-provisioned (bootstrap) and cannot
 * be locked out via the DB. Read-mostly: safe to call on every request. Does NOT
 * record a login (see recordPlatformAdminLogin).
 */
export async function resolvePlatformAdmin(
  email: string | null | undefined
): Promise<PlatformAdmin | null> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return null;
  const envAdmin = isPlatformAdmin(normalized);

  let row = await prismaAdmin.platformAdmin.findUnique({
    where: { email: normalized },
  });

  if (!row) {
    if (!envAdmin) return null;
    row = await prismaAdmin.platformAdmin.create({
      data: { email: normalized, addedBy: 'env:PLATFORM_ADMIN_EMAILS' },
    });
  }

  // Env-listed admins are always effective even if the row was deactivated.
  if (!row.isActive && !envAdmin) return null;
  return row;
}

/** Stamp userId + lastLoginAt on sign-in. Env admins are (re)activated here. */
export async function recordPlatformAdminLogin(
  email: string,
  userId: string
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const envAdmin = isPlatformAdmin(normalized);
  try {
    await prismaAdmin.platformAdmin.update({
      where: { email: normalized },
      data: { userId, lastLoginAt: new Date(), ...(envAdmin ? { isActive: true } : {}) },
    });
  } catch (e) {
    console.error('[platform] recordPlatformAdminLogin failed:', e);
  }
}

/** Server guard for the platform-admin pages/actions. */
export async function requirePlatformAdmin(): Promise<PlatformAdmin> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const admin = await resolvePlatformAdmin(user.email);
  if (!admin) redirect('/app/dashboard');
  return admin;
}

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  return prismaAdmin.platformAdmin.findMany({ orderBy: { createdAt: 'asc' } });
}

/** True if the email is pinned by the env allow-list (cannot be removed in-app). */
export function isEnvPlatformAdmin(email: string): boolean {
  return isPlatformAdmin(email);
}

export async function addPlatformAdmin(
  email: string,
  actor: PlatformAdmin
): Promise<{ ok: boolean; error?: string }> {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return { ok: false, error: 'Enter a valid email.' };
  const row = await prismaAdmin.platformAdmin.upsert({
    where: { email: e },
    update: { isActive: true },
    create: { email: e, addedBy: actor.email },
  });
  await recordAudit({
    action: 'platform.admin.add',
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: 'platform_admin',
    entityId: row.id,
    metadata: { email: e },
  });
  return { ok: true };
}

export async function setPlatformAdminActive(
  id: bigint,
  isActive: boolean,
  actor: PlatformAdmin
): Promise<{ ok: boolean; error?: string }> {
  const target = await prismaAdmin.platformAdmin.findUnique({ where: { id } });
  if (!target) return { ok: false, error: 'Not found.' };
  if (isEnvPlatformAdmin(target.email)) {
    return { ok: false, error: 'This admin is pinned by PLATFORM_ADMIN_EMAILS.' };
  }
  if (target.id === actor.id) return { ok: false, error: 'You cannot change your own access.' };
  await prismaAdmin.platformAdmin.update({ where: { id }, data: { isActive } });
  await recordAudit({
    action: 'platform.admin.update',
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: 'platform_admin',
    entityId: id,
    metadata: { isActive },
  });
  return { ok: true };
}

export async function removePlatformAdmin(
  id: bigint,
  actor: PlatformAdmin
): Promise<{ ok: boolean; error?: string }> {
  const target = await prismaAdmin.platformAdmin.findUnique({ where: { id } });
  if (!target) return { ok: false, error: 'Not found.' };
  if (isEnvPlatformAdmin(target.email)) {
    return { ok: false, error: 'This admin is pinned by PLATFORM_ADMIN_EMAILS.' };
  }
  if (target.id === actor.id) return { ok: false, error: 'You cannot remove yourself.' };
  await prismaAdmin.platformAdmin.delete({ where: { id } });
  await recordAudit({
    action: 'platform.admin.remove',
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: 'platform_admin',
    entityId: id,
    metadata: { email: target.email },
  });
  return { ok: true };
}

// ── Cross-tenant user management ────────────────────────────────────────────────

/** Ban (deactivate) a company user: app-level isActive=false + Supabase auth ban. */
export async function banUser(
  userId: string,
  banned: boolean,
  actor: PlatformAdmin
): Promise<{ ok: boolean; error?: string }> {
  const target = await prismaAdmin.daraUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: 'User not found.' };
  await prismaAdmin.daraUser.update({
    where: { id: userId },
    data: { isActive: !banned },
  });
  // Best-effort: also block token refresh at the auth layer.
  try {
    await authAdmin().auth.admin.updateUserById(userId, {
      ban_duration: banned ? '876000h' : 'none',
    } as any);
  } catch (e) {
    console.error('[platform] auth ban toggle failed:', e);
  }
  await recordAudit({
    action: banned ? 'platform.user.ban' : 'platform.user.unban',
    companyId: target.companyId,
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: 'user',
    entityId: userId,
    metadata: { email: target.email },
  });
  return { ok: true };
}

/** Permanently delete a company user (DB row cascades) and their Supabase auth user. */
export async function deleteUser(
  userId: string,
  actor: PlatformAdmin
): Promise<{ ok: boolean; error?: string }> {
  const target = await prismaAdmin.daraUser.findUnique({ where: { id: userId } });
  if (!target) return { ok: false, error: 'User not found.' };
  await prismaAdmin.daraUser.delete({ where: { id: userId } });
  try {
    await authAdmin().auth.admin.deleteUser(userId);
  } catch (e) {
    console.error('[platform] auth user delete failed:', e);
  }
  await recordAudit({
    action: 'platform.user.delete',
    companyId: target.companyId,
    actorId: actor.userId,
    actorEmail: actor.email,
    entityType: 'user',
    entityId: userId,
    metadata: { email: target.email },
  });
  return { ok: true };
}
