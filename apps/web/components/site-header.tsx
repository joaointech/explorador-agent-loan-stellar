"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { LogoWhite, Wordmark } from "@/components/logo";
import { DemoClockChip } from "@/components/demo-clock-chip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { apiPost } from "@/lib/client/api";
import { useMe, usePoolStats } from "@/lib/client/hooks";
import { cn } from "@/lib/utils";

const baseLinks = [
  { href: "/registry", label: "Registry" },
  { href: "/invest", label: "Invest" },
  { href: "/agent", label: "Agent" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const pool = usePoolStats(30_000);
  const [open, setOpen] = React.useState(false);

  // Refresh "who am I" whenever the route changes (e.g. after login).
  const refreshMe = me.refresh;
  React.useEffect(() => {
    void refreshMe();
  }, [pathname, refreshMe]);

  const user = me.data?.user ?? null;
  const links = user?.role === "ADMIN" ? [...baseLinks, { href: "/admin", label: "Admin" }] : baseLinks;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  async function logout() {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* ignore */
    }
    setOpen(false);
    await me.refresh();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 bg-nav text-white shadow-[0_1px_0_rgba(255,255,255,0.06)] lg:bg-nav/95 lg:backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:py-3.5">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2 hover:opacity-90" aria-label="explorador advance — home">
          <LogoWhite size={34} className="sm:hidden" />
          <LogoWhite size={38} className="hidden sm:block" />
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-3 text-[15px] font-medium lg:flex" aria-label="Main">
          {links.map((l, i) => (
            <React.Fragment key={l.href}>
              {i > 0 && <span aria-hidden className="h-4 w-px bg-blue-200/60 dark:bg-slate-600" />}
              <Link
                href={l.href}
                className={cn("transition-opacity hover:opacity-80", isActive(l.href) && "underline decoration-white/60 decoration-2 underline-offset-[6px]")}
              >
                {l.label}
              </Link>
            </React.Fragment>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-2">
          <DemoClockChip demo={pool.data?.demo} className="hidden md:inline-flex" />
          {user ? (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                href={user.role === "ADMIN" ? "/admin" : "/agent"}
                className="flex size-9 items-center justify-center rounded-full bg-white/15 text-sm font-bold uppercase ring-1 ring-white/25 hover:bg-white/25"
                title={user.email}
              >
                {user.email.slice(0, 1)}
              </Link>
              <button onClick={logout} className="rounded-lg p-2 text-white/80 hover:bg-white/15 hover:text-white" title="Sign out" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname.startsWith("/admin") ? "/admin" : "/agent")}`}
              className="hidden min-w-[6rem] items-center justify-center rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/25 sm:inline-flex"
            >
              Sign in
            </Link>
          )}
          <button
            className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/15 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>
      {pool.data?.demo && pool.data.demo.offsetSecs > 0 && (
        <div className="flex justify-center pb-2 md:hidden">
          <DemoClockChip demo={pool.data.demo} />
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="bg-nav p-0 text-white sm:p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <div className="flex items-center gap-2 px-5 pb-2 pt-5">
            <LogoWhite size={30} />
            <Wordmark className="[&>span:first-child]:text-xl" />
          </div>
          <nav className="flex flex-col px-3 py-2" aria-label="Mobile">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={cn("rounded-xl px-3 py-3 text-base font-semibold hover:bg-white/10", isActive(l.href) && "bg-white/15")}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto border-t border-white/15 px-5 py-4">
            {user ? (
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-white/80">{user.email}</span>
                <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/25">
                  <LogOut className="size-4" /> Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex h-11 items-center justify-center rounded-xl bg-white text-[15px] font-semibold text-blue-600"
              >
                Sign in →
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
