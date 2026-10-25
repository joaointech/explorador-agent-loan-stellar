"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "./cn";

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts (e.g. a LAN IP during development).
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

/** Small icon button that copies `value` and confirms with a check mark (announced to screen readers). */
export function CopyButton({
  value,
  label = "Copy",
  className,
  iconClassName,
}: {
  value: string;
  /** Accessible name, e.g. "Copy address". */
  label?: string;
  className?: string;
  iconClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      <button
        type="button"
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
        onClick={async () => {
          try {
            await writeClipboard(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          } catch {
            // Clipboard blocked: nothing to confirm.
          }
        }}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-slate-100 hover:text-fg dark:hover:bg-slate-800",
          copied && "text-emerald-600 dark:text-emerald-400",
          className,
        )}
      >
        {copied ? (
          <Check aria-hidden className={cn("size-3.5", iconClassName)} />
        ) : (
          <Copy aria-hidden className={cn("size-3.5", iconClassName)} />
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
