'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserRound, Upload, Trash2, Check, AlertTriangle, Loader2 } from 'lucide-react';
import {
  card,
  btnPrimary,
  btnGhost,
  fieldClasses,
  sectionTitle,
  monoLabel
} from '@/components/dara/theme';
import { updateProfileName, updateAvatar, removeAvatarAction } from './actions';

export default function ProfilePanel({
  name,
  email,
  avatarUrl
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(name);
  const [savedName, setSavedName] = useState(name);
  const [busy, setBusy] = useState<'name' | 'avatar' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  const initials = (name || email || '?').slice(0, 2).toUpperCase();

  async function saveName() {
    setError('');
    setBusy('name');
    try {
      const fd = new FormData();
      fd.set('name', displayName);
      const res = await updateProfileName(fd);
      if (!res.ok) throw new Error(res.error);
      setSavedName(displayName);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      router.refresh();
    } catch (e: any) {
      setError(e.message || 'Could not save.');
    } finally {
      setBusy(null);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy('avatar');
    try {
      const fd = new FormData();
      fd.set('avatar', file);
      const res = await updateAvatar(fd);
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    } catch (e: any) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeIt() {
    setError('');
    setBusy('remove');
    try {
      const res = await removeAvatarAction();
      if (!res.ok) throw new Error(res.error);
      router.refresh();
    } catch (e: any) {
      setError(e.message || 'Could not remove.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${card} p-6`}>
      <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
        <UserRound className="h-4 w-4 text-navy" />
        Profile
      </h2>

      {/* Avatar */}
      <div className="mb-6 flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt="Your avatar"
            className="h-16 w-16 flex-shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-gold text-lg font-bold text-navy">
            {initials}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPickFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy !== null}
            className={btnGhost}
          >
            {busy === 'avatar' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {avatarUrl ? 'Change avatar' : 'Upload avatar'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={removeIt}
              disabled={busy !== null}
              className={btnGhost}
            >
              {busy === 'remove' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove
            </button>
          )}
          <span className="w-full text-[11px] text-t5">PNG, JPG, or WebP · up to 5 MB</span>
        </div>
      </div>

      {/* Name */}
      <label className={monoLabel} htmlFor="display-name">
        Display name
      </label>
      <input
        id="display-name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={255}
        className={`${fieldClasses} mt-1`}
        placeholder="Your name"
      />

      {/* Email (read-only identity) */}
      <div className="mt-4">
        <div className={monoLabel}>Email</div>
        <div className="mt-1 text-sm text-t3">{email}</div>
        <p className="mt-1 text-[11px] text-t5">
          Your email is your sign-in identity and can't be edited here.
        </p>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[#991B1B]/30 bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={saveName}
          disabled={busy !== null || displayName.trim() === savedName || displayName.trim() === ''}
          className={btnPrimary}
        >
          {busy === 'name' && <Loader2 className="h-4 w-4 animate-spin" />}
          {savedFlash ? <Check className="h-4 w-4" /> : null}
          {savedFlash ? 'Saved' : 'Save name'}
        </button>
      </div>
    </div>
  );
}
