"use client";

import { createContext, useContext, useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "./cn";

interface TabsState {
  value: string;
  select: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsState | null>(null);
const ListContext = createContext<{ variant: "pill" | "underline"; fullWidth: boolean }>({ variant: "pill", fullWidth: false });

function useTabs(): TabsState {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs parts must be used inside <Tabs>");
  return ctx;
}

const tabId = (baseId: string, value: string) => `${baseId}-tab-${value}`;
const panelId = (baseId: string, value: string) => `${baseId}-panel-${value}`;

/**
 * Accessible tabs (WAI-ARIA tablist, arrow keys / Home / End, automatic activation).
 *
 *   <Tabs defaultValue="deposit">
 *     <TabsList aria-label="Vault action">
 *       <TabsTrigger value="deposit">Deposit</TabsTrigger>
 *       <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="deposit">…</TabsContent>
 *     <TabsContent value="withdraw">…</TabsContent>
 *   </Tabs>
 */
export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const baseId = useId();
  const value = controlled ?? uncontrolled;
  const select = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value, select, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

/** The row of tabs. `pill` = segmented control (default); `underline` = page-level tabs. */
export function TabsList({
  variant = "pill",
  fullWidth = false,
  className,
  children,
  ...aria
}: {
  variant?: "pill" | "underline";
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  };
  return (
    <ListContext.Provider value={{ variant, fullWidth }}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className={cn(
          "no-scrollbar max-w-full overflow-x-auto",
          variant === "pill"
            ? "inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:ring-slate-700"
            : "flex items-center gap-6 border-b border-line",
          fullWidth && "flex w-full",
          className,
        )}
        {...aria}
      >
        {children}
      </div>
    </ListContext.Provider>
  );
}

export function TabsTrigger({
  value,
  disabled,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { value: selected, select, baseId } = useTabs();
  const { variant, fullWidth } = useContext(ListContext);
  const active = selected === value;
  return (
    <button
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={active}
      aria-controls={panelId(baseId, value)}
      // Roving tab stop on the selected tab; if none is selected yet, every tab stays reachable.
      tabIndex={active || selected === "" ? 0 : -1}
      disabled={disabled}
      onClick={() => select(value)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-50 [&_svg]:size-4",
        variant === "pill"
          ? cn(
              "min-h-9 rounded-lg px-3.5 py-1.5",
              active
                ? "bg-white text-heading shadow-sm dark:bg-slate-600 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-300 dark:hover:text-white",
            )
          : cn(
              "-mb-px min-h-11 border-b-2 px-0.5 pb-2.5",
              active
                ? "border-primary text-heading"
                : "border-transparent text-muted hover:border-slate-300 hover:text-fg dark:hover:border-slate-600",
            ),
        fullWidth && "flex-1",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const { value: selected, baseId } = useTabs();
  if (selected !== value) return null;
  return (
    <div role="tabpanel" id={panelId(baseId, value)} aria-labelledby={tabId(baseId, value)} tabIndex={0} className={cn("mt-4 outline-none", className)}>
      {children}
    </div>
  );
}
