import { Rocket, ServerCrash } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

function Notice({ icon, title, children, action, tone }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode; tone: "info" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-4 rounded-panel border p-5 sm:flex-row sm:items-center sm:p-6",
        tone === "error"
          ? "border-red-200 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/10"
          : "border-primary/20 bg-primary-tint",
      )}
    >
      <span
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-2xl ring-1 [&_svg]:size-6",
          tone === "error" ? "bg-card text-red-600 ring-red-200 dark:text-red-400 dark:ring-red-500/30" : "bg-card text-primary-text ring-primary/20",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-heading">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-muted">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** No contracts on testnet yet (GET /api/config → deployment: null). */
export function NotDeployedNotice() {
  return (
    <Notice icon={<Rocket />} title="The pool isn't deployed yet" tone="info">
      <p>
        explorador advance runs on Stellar testnet. As soon as the contracts are deployed, this page connects to them: pool health, history, deposits and
        withdrawals light up here. Meanwhile you can connect Freighter and get test XLM.
      </p>
      <p className="mt-1 text-xs">
        Operators: <code className="font-mono">pnpm deploy:testnet</code> writes <code className="font-mono">deployments/testnet.json</code>.
      </p>
    </Notice>
  );
}

/** GET /api/config failed. */
export function ConfigErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      icon={<ServerCrash />}
      title="Can't load the pool right now"
      tone="error"
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>The app couldn&apos;t read its configuration ({message}). Check your connection and try again.</p>
    </Notice>
  );
}
