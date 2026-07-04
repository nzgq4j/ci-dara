'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { useFormStatus } from 'react-dom';
import { Plus, X } from 'lucide-react';

// Lets a form inside the modal close it once its server action has finished.
const ModalCloseContext = createContext<() => void>(() => {});

// Drop this inside a server-action <form> rendered within an AddSection modal. It keeps
// the form mounted while the action is dispatching and running, then closes the modal the
// moment the action resolves.
//
// This REPLACES the previous capture-phase `submit` listener, which unmounted the form
// during the submit event — a race that could tear the form down before React dispatched
// the server action, swallowing the submission entirely (symptom: "clicked Create, nothing
// happened, no review created"). Waiting on useFormStatus guarantees the action fires first.
export function CloseModalOnComplete() {
  const close = useContext(ModalCloseContext);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
    } else if (wasPending.current) {
      wasPending.current = false;
      close();
    }
  }, [pending, close]);

  return null;
}

// An "add" affordance: a compact button that opens the form in a MODAL — never a
// persistent blank card/object in the list. The form (a server-action form) is passed as
// children. Include <CloseModalOnComplete /> inside that form to auto-close on success.
export default function AddSection({
  label,
  children,
  className = ''
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3.5 py-2 text-[13px] font-medium text-t3 transition-colors hover:border-navy/50 hover:text-t1 ${className}`}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10"
          role="dialog"
          aria-modal="true"
          onClick={close}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-line bg-surf p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-t1">{label}</h2>
              <button
                type="button"
                onClick={close}
                className="text-t5 transition-colors hover:text-t2"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ModalCloseContext.Provider value={close}>
              {children}
            </ModalCloseContext.Provider>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
