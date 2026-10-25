import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { EXPLORER_BASE } from "@/lib/format";

import { PUBLIC_NAV } from "./nav";

// Module scope, not render: the year is fixed per build.
const YEAR = new Date().getFullYear();

const RESOURCES = [
  { href: EXPLORER_BASE, label: "Stellar testnet explorer", external: true },
  { href: "https://www.freighter.app", label: "Freighter wallet", external: true },
  { href: "/design", label: "Design system", external: false },
];

const linkClass = "transition-colors hover:text-white";

function FooterLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {label} <span aria-hidden>↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={href} className={linkClass}>
      {label}
    </Link>
  );
}

function ColumnTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-base font-bold text-white">{children}</h2>;
}

/**
 * Footer modelled on explorador.pt: brand-blue (slate-900 in dark), brand
 * column + link columns, and a bottom bar with the Light/System/Dark toggle.
 */
export function Footer() {
  return (
    <footer className="bg-primary/90 text-sm text-white/80 dark:bg-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 text-center lg:text-left">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:gap-10">
          <div className="col-span-2 flex flex-col items-center gap-3 lg:col-span-1 lg:items-start">
            <Logo markClassName="size-8" />
            <p className="max-w-xs text-xs leading-relaxed">
              Agents spend their commission the day the CPCV is signed. Investors earn the interest. Every deal is
              proven on Stellar with zero-knowledge proofs.
            </p>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/15">
              <FlaskConical aria-hidden className="size-3.5" />
              Testnet demo · not financial advice
            </p>
          </div>

          <nav aria-label="Product" className="flex flex-col gap-3">
            <ColumnTitle>Product</ColumnTitle>
            <ul className="flex flex-col gap-2">
              {PUBLIC_NAV.map((l) => (
                <li key={l.href}>
                  <FooterLink href={l.href} label={l.label} />
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Resources" className="flex flex-col gap-3">
            <ColumnTitle>Resources</ColumnTitle>
            <ul className="flex flex-col gap-2">
              {RESOURCES.map((l) => (
                <li key={l.href}>
                  <FooterLink {...l} />
                </li>
              ))}
            </ul>
          </nav>

          <div className="col-span-2 flex flex-col gap-3 lg:col-span-1">
            <ColumnTitle>explorador</ColumnTitle>
            <p className="mx-auto max-w-xs text-xs leading-relaxed lg:mx-0">
              The AI real-estate platform for Portugal. Agents work explorador&apos;s leads and split every
              commission 50/50.
            </p>
            <p>
              <FooterLink href="https://explorador.pt" label="explorador.pt" external />
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4 border-t border-white/15 pt-5 text-xs lg:flex-row lg:justify-between">
          <span className="order-2 lg:order-1">
            © {YEAR} explorador · Testnet demo · not financial advice
          </span>
          <ThemeToggle variant="onPrimary" className="order-1 lg:order-2" />
        </div>
      </div>
    </footer>
  );
}
