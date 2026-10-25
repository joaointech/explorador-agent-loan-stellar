import { Check, LoaderCircle, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export type StepStatus = "idle" | "active" | "done" | "error";

export interface Step {
  id: string;
  label: ReactNode;
  status: StepStatus;
  /** Second line: what happens, or the error message. */
  description?: ReactNode;
  /** Right-aligned detail in vertical steppers: duration, tx link… */
  meta?: ReactNode;
}

const SR_STATUS: Record<StepStatus, string> = {
  idle: "not started",
  active: "in progress",
  done: "completed",
  error: "failed",
};

/** `busy`: the active step spins (work in progress, e.g. the proof pipeline); otherwise it shows its number (the user's turn). */
function StepIcon({ status, index, size, busy = true }: { status: StepStatus; index: number; size: "sm" | "md"; busy?: boolean }) {
  const box = size === "sm" ? "size-7 text-xs" : "size-8 text-sm";
  if (status === "done") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary text-white", box)}>
        <Check aria-hidden className="size-4" strokeWidth={2.25} />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary-text ring-4 ring-primary/20", box)}>
        {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin" strokeWidth={2} /> : index + 1}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-red-600 text-white dark:bg-red-500", box)}>
        <X aria-hidden className="size-4" strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-400 dark:bg-slate-800 dark:text-slate-500", box)}>
      {index + 1}
    </span>
  );
}

/**
 * Progress through a sequence of steps, each idle / active / done / error.
 * - `vertical` (default): the admin proof pipeline (Validating → Signing
 *   attestation → Generating ZK proof → … → Done), with descriptions and meta.
 * - `horizontal`: compact onboarding rail (email → passkey → card → activate);
 *   labels collapse to the current step on narrow screens. Its current step
 *   waits for the user, so it shows its number instead of a spinner.
 */
export function Stepper({
  steps,
  orientation = "vertical",
  label = "Progress",
  className,
}: {
  steps: Step[];
  orientation?: "vertical" | "horizontal";
  /** Accessible name of the list. */
  label?: string;
  className?: string;
}) {
  if (orientation === "horizontal") {
    return (
      <ol aria-label={label} className={cn("flex w-full items-start", className)}>
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li
              key={step.id}
              aria-current={step.status === "active" ? "step" : undefined}
              className={cn("relative flex min-w-0 flex-col items-center gap-2 text-center", last ? "flex-none" : "flex-1")}
            >
              <div className="flex w-full items-center">
                <StepIcon status={step.status} index={i} size="sm" busy={false} />
                {!last && (
                  <span
                    aria-hidden
                    className={cn("mx-2 h-0.5 flex-1 rounded-full", step.status === "done" ? "bg-primary" : "bg-slate-200 dark:bg-slate-700")}
                  />
                )}
              </div>
              <span
                className={cn(
                  "w-full truncate pr-2 text-left text-xs font-medium",
                  step.status === "active" ? "text-heading" : "hidden text-muted sm:block",
                  step.status === "error" && "block text-red-600 dark:text-red-400",
                )}
              >
                {step.label}
                <span className="sr-only">, {SR_STATUS[step.status]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.id} aria-current={step.status === "active" ? "step" : undefined} className="relative flex gap-3.5">
            <div className="flex flex-col items-center">
              <StepIcon status={step.status} index={i} size="md" />
              {!last && (
                <span
                  aria-hidden
                  className={cn("my-1 w-0.5 flex-1 rounded-full", step.status === "done" ? "bg-primary" : "bg-slate-200 dark:bg-slate-700")}
                />
              )}
            </div>
            <div className={cn("flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1", last ? "pb-0" : "pb-5")}>
              <div className="min-w-0 pt-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    step.status === "idle" ? "text-muted" : "text-heading",
                    step.status === "error" && "text-red-600 dark:text-red-400",
                  )}
                >
                  {step.label}
                  <span className="sr-only">, {SR_STATUS[step.status]}</span>
                </p>
                {step.description && (
                  <p className={cn("mt-0.5 text-sm leading-relaxed", step.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted")}>
                    {step.description}
                  </p>
                )}
              </div>
              {step.meta && <div className="pt-1 text-xs text-muted tabular-nums">{step.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Builds step statuses from an ordered list of ids and the current position:
 * steps before `current` are done, `current` is active (or error when
 * `failed`), the rest idle. `current = ids.length` marks all done.
 */
export function stepsFrom<T extends string>(
  ids: readonly { id: T; label: ReactNode; description?: ReactNode }[],
  current: number,
  failed = false,
): Step[] {
  return ids.map((s, i) => ({
    ...s,
    status: i < current ? "done" : i === current ? (failed ? "error" : "active") : "idle",
  }));
}
