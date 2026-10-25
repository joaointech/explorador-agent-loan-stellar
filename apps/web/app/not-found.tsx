import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Branded 404 (explorador.pt NotFoundView), inside the app shell. */
export default function NotFound() {
  return (
    <div className="relative flex min-h-[70vh] items-center justify-center overflow-hidden bg-section px-4 py-16">
      <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative w-full max-w-xl text-center">
        <p className="font-display text-[5.5rem] leading-none font-bold tracking-tight sm:text-[8rem]">
          <span className="bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">404</span>
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-heading sm:text-3xl">This deal fell through</h1>
        <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">
          The page you&apos;re looking for doesn&apos;t exist. Maybe the buyer walked away, or the link is wrong.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button href="/" size="lg">
            Back to home
          </Button>
          <Button href="/registry" size="lg" variant="secondary" arrow>
            Browse the registry
          </Button>
        </div>
      </div>
    </div>
  );
}
