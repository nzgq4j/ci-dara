// A thin progress bar. With `value`/`max` it renders a determinate fill; without,
// an indeterminate sweep (for AI actions whose length isn't known up front).
export default function ProgressBar({
  value,
  max,
  label,
  className = ''
}: {
  value?: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const determinate = value != null && max != null && max > 0;
  const pct = determinate ? Math.min(100, Math.round((value! / max!) * 100)) : 0;

  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[11px] text-t4">
          <span>{label}</span>
          {determinate && <span className="font-mono text-t5">{pct}%</span>}
        </div>
      )}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line">
        {determinate ? (
          <div
            className="h-full rounded-full bg-[#3b6ef0] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="progress-indeterminate" />
        )}
      </div>
    </div>
  );
}
