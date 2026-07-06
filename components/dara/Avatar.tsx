// Shared user avatar: renders the uploaded image when present, else a colored
// initials circle. Used anywhere a user "account circle" appears (Teams, sidebar,
// welcome, …) so uploaded avatars show consistently. Sizing/fallback color are
// passed in so each call site keeps its own look.

export function userInitials(name: string, email: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
  return (email?.[0] || parts[0]?.[0] || '?').toUpperCase();
}

export default function Avatar({
  avatarUrl,
  name = '',
  email = '',
  sizeClass = 'h-10 w-10 text-[12px]',
  fallbackClassName = 'bg-gold text-navy',
  fallbackStyle
}: {
  avatarUrl?: string | null;
  name?: string;
  email?: string;
  /** Tailwind sizing + text size, e.g. "h-10 w-10 text-[12px]". */
  sizeClass?: string;
  /** Fallback circle background/text when there's no image. */
  fallbackClassName?: string;
  /** Inline fallback background (e.g. a per-user hashed color). Wins over class bg. */
  fallbackStyle?: React.CSSProperties;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${sizeClass} ${fallbackClassName}`}
      style={fallbackStyle}
    >
      {userInitials(name, email)}
    </div>
  );
}
