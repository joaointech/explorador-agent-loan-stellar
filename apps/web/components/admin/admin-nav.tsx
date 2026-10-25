"use client";

import { FilePlus, FileText, Gauge, Timer, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

const LINKS = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/cpcvs/new", label: "New CPCV", icon: FilePlus },
  { href: "/admin/cpcvs", label: "CPCVs", icon: FileText },
  { href: "/admin/agents", label: "Agents", icon: Users },
  { href: "/admin/demo", label: "Demo", icon: Timer },
] as const;

/** The link whose href is the longest prefix of the path (so /admin/cpcvs/new picks "New CPCV", not "CPCVs"). */
function activeHref(pathname: string): string | undefined {
  return LINKS.map((l) => l.href as string)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/** Section tabs of the admin panel (page-level underline tabs, as links). */
export function AdminNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <nav aria-label="Admin sections" className={cn("no-scrollbar -mb-px overflow-x-auto", className)}>
      <ul className="flex min-w-max items-center gap-6">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const current = href === active;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 border-b-2 px-0.5 pb-2.5 text-sm font-semibold whitespace-nowrap transition-colors",
                  current ? "border-primary text-heading" : "border-transparent text-muted hover:border-slate-300 hover:text-fg dark:hover:border-slate-600",
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
