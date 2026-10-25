import Link from "next/link";
import { unstable_rethrow } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { getSessionUser } from "@/lib/auth/session";

import { AccountMenu, SignInButton } from "./account-menu";
import { DemoClockChip } from "./demo-clock";
import { DesktopNav } from "./desktop-nav";
import { MobileNav } from "./mobile-nav";
import { navFor, type HeaderUser } from "./nav";

/** Session user for the header, or null when signed out. Never throws for auth errors. */
async function readHeaderUser(): Promise<HeaderUser | null> {
  try {
    const user = await getSessionUser();
    return user ? { email: user.email, role: user.role } : null;
  } catch (err) {
    // Let Next.js handle its own control-flow errors (dynamic usage, redirects).
    unstable_rethrow(err);
    // Anything else (including the auth stub, which throws until that
    // workstream lands) renders the signed-out header.
    return null;
  }
}

/**
 * Full-width blue-600 bar (spec §10.1): white explorador mark + wordmark +
 * "advance" pill; Registry / Invest / Agent (+ Admin for admins) separated by
 * thin dividers; demo-clock chip; Sign in or the account menu on the right; a
 * hamburger menu below lg. Slate-900 in dark mode, as on explorador.pt.
 */
export async function Header() {
  const user = await readHeaderUser();
  const links = navFor(user);

  return (
    <header className="sticky top-0 z-40 bg-primary text-white lg:bg-primary/95 lg:backdrop-blur dark:bg-slate-900 lg:dark:bg-slate-900/95">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:py-4">
        <Link
          href="/"
          aria-label="explorador advance, home"
          className="flex shrink-0 items-center rounded-lg transition-opacity hover:opacity-85"
        >
          <Logo markClassName="size-[34px] sm:size-10" />
        </Link>

        <div className="ml-4 hidden lg:block">
          <DesktopNav links={links} />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <DemoClockChip placement="inline" />
          {user ? (
            <div className="hidden lg:block">
              <AccountMenu user={user} />
            </div>
          ) : (
            <SignInButton className="hidden lg:inline-flex" />
          )}
          <MobileNav links={links} user={user} />
        </div>
      </div>
      <DemoClockChip placement="bar" />
    </header>
  );
}
