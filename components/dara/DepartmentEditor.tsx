'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Users2, X, Check, Loader2 } from 'lucide-react';
import { btnPrimary, btnGhost, checkboxClasses } from '@/components/dara/theme';

type Dept = { id: string; name: string };

// Per-solicitation department-access editor, used on the Solicitations list (and
// mirrors the Overview tab's Departments card). Gated by the caller: only rendered
// when the viewer may manage departments (company admin or the solicitation's creator).
export default function DepartmentEditor({
  solId,
  title,
  allDepartments,
  assignedIds,
  action
}: {
  solId: string;
  title: string;
  allDepartments: Dept[];
  assignedIds: string[];
  action: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      await action(fd);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Edit department access"
        className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-t4 transition-colors hover:border-navy/50 hover:text-t1"
      >
        <Users2 className="h-3 w-3" />
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-line bg-surf p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-t1">Department access</h3>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="text-t5 transition-colors hover:text-t1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 truncate text-[12px] text-t4">{title}</p>

            <form onSubmit={onSubmit}>
              <input type="hidden" name="solId" value={solId} />

              {allDepartments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line bg-bg px-3 py-4 text-center text-[12px] text-t5">
                  No departments yet. Create them on the Team page.
                </p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {allDepartments.map((d) => (
                    <label
                      key={d.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 hover:bg-surf2"
                    >
                      <input
                        type="checkbox"
                        name="dept"
                        value={d.id}
                        defaultChecked={assignedIds.includes(d.id)}
                        className={checkboxClasses}
                      />
                      <span className="text-[13px] text-t2">{d.name}</span>
                    </label>
                  ))}
                </div>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-t5">
                Members of a selected department can view this solicitation. Company admins and the
                creator always have access. Leaving all unchecked limits it to admins and the creator.
              </p>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className={btnGhost}
                >
                  Cancel
                </button>
                <button type="submit" disabled={pending} className={btnPrimary}>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Save access
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
