'use client';

import { useFormStatus } from 'react-dom';

// Submit button that swaps to a pending label/spinner while its enclosing
// server-action <form> is submitting. Place inside a <form action={...}>.
export default function SubmitButton({
  className,
  children,
  pending: pendingChildren,
  disabled
}: {
  className?: string;
  children: React.ReactNode;
  pending?: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending ? (pendingChildren ?? children) : children}
    </button>
  );
}
