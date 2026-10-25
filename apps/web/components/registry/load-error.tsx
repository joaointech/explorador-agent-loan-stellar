"use client";

import { CircleAlert, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

import type { ApiRequestError } from "./api-client";

/** One sentence a visitor can act on, from an API failure. */
export function describeApiError(error: ApiRequestError): string {
  if (error.status === 0) return error.message;
  if (error.status === 404 && error.code === "HTTP_404") return "This part of the API isn't available yet. Try again in a moment.";
  if (error.status >= 500) return `The server couldn't read the chain right now (${error.message}).`;
  return error.message;
}

/** Inline failure panel with a retry button. */
export function LoadError({ title, error, onRetry, className }: { title: string; error: ApiRequestError; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-card border border-dashed border-red-300 bg-red-50/60 px-6 py-10 text-center dark:border-red-500/30 dark:bg-red-500/5",
        className,
      )}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-red-100 text-red-600 ring-1 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300">
        <CircleAlert aria-hidden className="size-6" />
      </span>
      <p className="text-base font-semibold text-heading">{title}</p>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">{describeApiError(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" icon={<RotateCw aria-hidden className="size-4" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
