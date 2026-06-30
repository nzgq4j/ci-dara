'use client';

// Submit button that asks for confirmation before allowing the (server-action) form
// to submit. Use for destructive actions inside a server-action <form>.
export default function ConfirmButton({
  message,
  className,
  children
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
