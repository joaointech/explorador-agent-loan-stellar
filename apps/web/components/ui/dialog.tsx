"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "./cn";

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
} as const;

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row pinned to the bottom (buttons). */
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  /** Hide the close (X) button; Escape and the backdrop still close it. */
  hideClose?: boolean;
  /** Prevent closing via Escape/backdrop while something is pending. */
  dismissible?: boolean;
  className?: string;
}

/**
 * Modal built on the native <dialog> (focus trap, Escape, inert page and
 * top layer for free). Controlled: pass `open` and `onOpenChange`.
 *
 *   <Dialog open={open} onOpenChange={setOpen} title="Confirm escritura" footer={<Button>Confirm</Button>}>…</Dialog>
 */
export function Dialog(props: DialogProps) {
  return <ModalBase {...props} presentation="dialog" />;
}

/**
 * Bottom sheet on phones (slides up from the bottom edge, grab handle), a
 * centered dialog from `sm` up. Use for mobile-first flows such as
 * "Simulate purchase".
 */
export function Sheet(props: DialogProps) {
  return <ModalBase {...props} presentation="sheet" />;
}

function ModalBase({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  hideClose = false,
  dismissible = true,
  className,
  presentation,
}: DialogProps & { presentation: "dialog" | "sheet" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const sheet = presentation === "sheet";

  return (
    <dialog
      ref={ref}
      data-presentation={presentation}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => onOpenChange(false)}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
      onClick={(e) => {
        // Backdrop click: the event targets the <dialog> itself and lands outside its box
        // (taps on the dialog's own surface, e.g. beside the sheet handle, stay open).
        if (!dismissible || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) onOpenChange(false);
      }}
      className={cn(
        "fixed inset-0 m-auto flex-col overflow-hidden border border-line bg-card p-0 text-fg shadow-pop open:flex",
        "h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-none rounded-panel",
        sheet &&
          "max-sm:mb-0 max-sm:max-h-[92dvh] max-sm:w-full max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)]",
        SIZES[size],
        className,
      )}
    >
      {sheet && <span aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden dark:bg-slate-600" />}
      <div className={cn("flex items-start justify-between gap-4 px-5 pt-5 sm:px-6", sheet && "max-sm:pt-3")}>
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-bold text-heading">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {!hideClose && (
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="-mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:bg-slate-100 hover:text-fg dark:hover:bg-slate-800"
          >
            <X aria-hidden className="size-5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-5 sm:px-6">{children}</div>
      {footer && (
        <div className="flex flex-col-reverse gap-2 border-t border-line bg-card-muted px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          {footer}
        </div>
      )}
    </dialog>
  );
}
