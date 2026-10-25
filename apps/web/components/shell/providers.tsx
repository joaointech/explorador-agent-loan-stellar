"use client";

import { LucideProvider } from "lucide-react";
import type { ReactNode } from "react";

import { ThemeSync } from "@/components/theme/theme-sync";
import { ToastProvider } from "@/components/ui/toast";

/** App-wide client providers: lucide icons default to a 1.5 px stroke (spec §10.1), toasts, theme sync. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LucideProvider strokeWidth={1.5}>
      <ToastProvider>
        <ThemeSync />
        {children}
      </ToastProvider>
    </LucideProvider>
  );
}
