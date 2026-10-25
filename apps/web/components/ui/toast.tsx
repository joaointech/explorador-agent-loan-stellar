"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "./cn";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  /** Internal path or external URL (external opens in a new tab). */
  href?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Auto-dismiss after this many ms; 0 keeps it until dismissed. Default 5000 (errors 8000). */
  duration?: number;
  action?: ToastAction;
}

interface ToastItem extends ToastOptions {
  id: number;
}

export interface ToastApi {
  toast: (options: ToastOptions) => number;
  success: (title: ReactNode, options?: Omit<ToastOptions, "title" | "tone">) => number;
  error: (title: ReactNode, options?: Omit<ToastOptions, "title" | "tone">) => number;
  info: (title: ReactNode, options?: Omit<ToastOptions, "title" | "tone">) => number;
  warning: (title: ReactNode, options?: Omit<ToastOptions, "title" | "tone">) => number;
  /** Dismiss one toast, or all when called without an id. */
  dismiss: (id?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 4;

/**
 * Mount once (app/layout.tsx does, via Providers). Then anywhere in a client component:
 *
 *   const toast = useToast();
 *   toast.success("Deposit confirmed", { action: { label: "View transaction", href: explorerTxUrl(hash) } });
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = (id?: number) => setItems((xs) => (id === undefined ? [] : xs.filter((t) => t.id !== id)));
  const toast = (options: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((xs) => [...xs.slice(-(MAX_VISIBLE - 1)), { ...options, id }]);
    return id;
  };
  const api: ToastApi = {
    toast,
    dismiss,
    success: (title, options) => toast({ ...options, title, tone: "success" }),
    error: (title, options) => toast({ ...options, title, tone: "error" }),
    info: (title, options) => toast({ ...options, title, tone: "info" }),
    warning: (title, options) => toast({ ...options, title, tone: "warning" }),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end sm:p-6"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Toast API from the nearest ToastProvider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider> (mounted in app/layout.tsx)");
  return ctx;
}

const TONES: Record<ToastTone, { icon: LucideIcon; iconClass: string; railClass: string }> = {
  success: { icon: CircleCheck, iconClass: "text-emerald-500", railClass: "bg-emerald-500/70" },
  error: { icon: CircleAlert, iconClass: "text-red-500", railClass: "bg-red-500/70" },
  info: { icon: Info, iconClass: "text-primary-text", railClass: "bg-primary/70" },
  warning: { icon: TriangleAlert, iconClass: "text-amber-500", railClass: "bg-amber-500/70" },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = item.tone ?? "info";
  const duration = item.duration ?? (tone === "error" ? 8000 : 5000);
  const { icon: Icon, iconClass, railClass } = TONES[tone];

  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
    // onDismiss is recreated each render; the timer must only depend on the toast itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, duration]);

  const external = item.action?.href?.startsWith("http");
  const actionClass =
    "mt-2 inline-flex items-center text-sm font-semibold text-primary-text underline-offset-4 hover:underline";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="pointer-events-auto relative flex w-full max-w-sm animate-toast-in items-start gap-3 overflow-hidden rounded-xl border border-line bg-card px-4 py-3 shadow-pop"
    >
      <Icon aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-heading">{item.title}</p>
        {item.description && <div className="mt-0.5 text-sm text-muted">{item.description}</div>}
        {item.action &&
          (item.action.href ? (
            external ? (
              <a href={item.action.href} target="_blank" rel="noopener noreferrer" className={actionClass}>
                {item.action.label} ↗
              </a>
            ) : (
              <Link href={item.action.href} onClick={item.action.onClick} className={actionClass}>
                {item.action.label}
              </Link>
            )
          ) : (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick?.();
                onDismiss();
              }}
              className={actionClass}
            >
              {item.action.label}
            </button>
          ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mt-1 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-full text-subtle transition-colors hover:bg-slate-100 hover:text-fg dark:hover:bg-slate-800"
      >
        <X aria-hidden className="size-4" />
      </button>
      {duration > 0 && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-slate-100 dark:bg-slate-800">
          <span
            className={cn("block h-full w-full origin-left animate-toast-countdown", railClass)}
            style={{ animationDuration: `${duration}ms` }}
          />
        </span>
      )}
    </div>
  );
}
