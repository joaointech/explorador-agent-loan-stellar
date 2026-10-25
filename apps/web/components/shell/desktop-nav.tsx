"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { cn } from "@/components/ui/cn";

import { isActivePath, type NavLink } from "./nav";

/** Thin translucent divider between header links (explorador.pt NavRule). */
function NavRule() {
  return <span aria-hidden className="h-4 w-px bg-blue-200/60 dark:bg-slate-600" />;
}

/** Inline header links (lg and up), separated by thin dividers; the current section is underlined. */
export function DesktopNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="hidden items-center gap-3 text-base font-medium text-white lg:flex">
      {links.map((link, i) => {
        const active = isActivePath(pathname, link.href);
        return (
          <Fragment key={link.href}>
            {i > 0 && <NavRule />}
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-md px-1 py-1 transition-opacity hover:opacity-80",
                active &&
                  "font-semibold after:absolute after:inset-x-1 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-white",
              )}
            >
              {link.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}
