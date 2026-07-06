'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { prismaAdmin } from '@/utils/prisma';
import { getDaraUser } from '@/utils/dara/provision';
import { recordAudit } from '@/utils/dara/audit';
import { uploadAvatar, removeAvatar } from '@/utils/dara/avatar';

type Result = { ok: boolean; error?: string };

// Resolve the signed-in DARA user for a self-service action. Returns null when the
// session is missing/disabled — actions fail closed on that.
async function currentUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) return null;
  return { supabase, authUser: user, daraUser };
}

/** Update the user's display name (dara_users.name + Supabase user_metadata). */
export async function updateProfileName(formData: FormData): Promise<Result> {
  const ctx = await currentUser();
  if (!ctx) return { ok: false, error: 'Not signed in.' };

  const name = String(formData.get('name') ?? '').trim().slice(0, 255);
  if (name.length < 1) return { ok: false, error: 'Name cannot be empty.' };

  await prismaAdmin.daraUser.update({
    where: { id: ctx.daraUser.id },
    data: { name }
  });
  // Keep Supabase metadata in sync so a future re-provision doesn't overwrite it.
  await ctx.supabase.auth.updateUser({ data: { full_name: name } });

  await recordAudit({
    action: 'account.profile.update',
    companyId: ctx.daraUser.companyId,
    actorId: ctx.daraUser.id,
    actorEmail: ctx.daraUser.email,
    entityType: 'user',
    entityId: ctx.daraUser.id,
    metadata: { field: 'name' }
  });
  revalidatePath('/app/account/profile');
  return { ok: true };
}

/** Upload/replace the user's avatar image. */
export async function updateAvatar(formData: FormData): Promise<Result> {
  const ctx = await currentUser();
  if (!ctx) return { ok: false, error: 'Not signed in.' };

  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose an image to upload.' };
  }
  try {
    // Deterministic-friendly stamp for cache-busting; Date.now is fine in a request.
    const url = await uploadAvatar(ctx.daraUser.id, file, Date.now());
    await prismaAdmin.daraUser.update({
      where: { id: ctx.daraUser.id },
      data: { avatarUrl: url }
    });
    await recordAudit({
      action: 'account.avatar.update',
      companyId: ctx.daraUser.companyId,
      actorId: ctx.daraUser.id,
      actorEmail: ctx.daraUser.email,
      entityType: 'user',
      entityId: ctx.daraUser.id
    });
    revalidatePath('/app/account/profile');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload failed.' };
  }
}

/** Remove the user's avatar (revert to initials). */
export async function removeAvatarAction(): Promise<Result> {
  const ctx = await currentUser();
  if (!ctx) return { ok: false, error: 'Not signed in.' };

  await removeAvatar(ctx.daraUser.id);
  await prismaAdmin.daraUser.update({
    where: { id: ctx.daraUser.id },
    data: { avatarUrl: null }
  });
  await recordAudit({
    action: 'account.avatar.remove',
    companyId: ctx.daraUser.companyId,
    actorId: ctx.daraUser.id,
    actorEmail: ctx.daraUser.email,
    entityType: 'user',
    entityId: ctx.daraUser.id
  });
  revalidatePath('/app/account/profile');
  return { ok: true };
}

/**
 * Set or change the account password. Works for OTP-invited users who never had a
 * password (updateUser adds one to the existing email identity) and for anyone
 * rotating an existing password.
 */
export async function setPassword(formData: FormData): Promise<Result> {
  const ctx = await currentUser();
  if (!ctx) return { ok: false, error: 'Not signed in.' };

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (password !== confirm) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  const { error } = await ctx.supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: error.message };
  }
  await recordAudit({
    action: 'account.password.set',
    companyId: ctx.daraUser.companyId,
    actorId: ctx.daraUser.id,
    actorEmail: ctx.daraUser.email,
    entityType: 'user',
    entityId: ctx.daraUser.id
  });
  return { ok: true };
}
