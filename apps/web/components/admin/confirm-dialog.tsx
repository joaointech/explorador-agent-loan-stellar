"use client";

import { CircleAlert, RotateCw, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/dialog";

import { toAdminApiError, type AdminApiError } from "./api";

/**
 * Confirm step for an on-chain admin action. Stays open while the transaction
 * runs (Escape and the backdrop are disabled), shows the error inline if it
 * fails, and closes when `onConfirm` resolves.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onConfirm,
  confirmDisabled = false,
  size = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => Promise<void>;
  confirmDisabled?: boolean;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (pending) return;
    setError(null);
    onOpenChange(next);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(toAdminApiError(err).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description={description}
      dismissible={!pending}
      hideClose={pending}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
            Back
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={pending} disabled={confirmDisabled} onClick={confirm}>
            {pending ? "Waiting for Stellar…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** A section that failed to load, with a retry button. */
export function LoadError({ error, onRetry, className }: { error: AdminApiError; onRetry: () => void; className?: string }) {
  return (
    <Card variant="muted" className={cn("flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-red-500" />
        <div>
          <p className="text-sm font-semibold text-heading">Couldn&apos;t load this section</p>
          <p className="mt-0.5 text-sm text-muted">{error.message}</p>
        </div>
      </div>
      <Button size="sm" variant="secondary" icon={<RotateCw className="size-4" />} onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

/** Amber banner listing reads that failed (chain or deployment), so partial data is never mistaken for zero. */
export function WarningsBanner({ warnings, className }: { warnings: string[]; className?: string }) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-card border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <ul className="flex flex-col gap-1">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
