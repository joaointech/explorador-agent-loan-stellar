import { FlaskConical } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/layout";

/** Closing band: the brand-gradient offer card from explorador.pt, on a warm band. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="bg-section py-12 sm:py-16">
      <Container>
        <div className="relative overflow-hidden rounded-panel bg-gradient-to-br from-blue-600 to-blue-800 px-6 py-8 text-white shadow-brand sm:px-10 sm:py-12">
          <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 size-48 rounded-full bg-blue-300/20 blur-3xl" />
          <div className="relative flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-blue-50 uppercase">
                <FlaskConical aria-hidden className="size-3.5" />
                Testnet demo
              </p>
              <h2 id="cta-title" className="mt-3 text-[1.6rem] leading-tight font-bold tracking-tight sm:text-4xl">
                Try it end to end.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-blue-50 sm:text-base">
                Spend with a sandbox card as an agent, or fund the pool with test euros from Freighter. Every number comes from Stellar testnet;
                none of it is real money.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row lg:flex-col xl:flex-row">
              <Button href="/agent" size="lg" variant="onPrimary" arrow className="focus-visible:outline-white">
                I&apos;m an agent
              </Button>
              <Button href="/invest" size="lg" variant="onPrimary" arrow className="bg-white/10 text-white ring-1 ring-white/40 hover:bg-white/20 focus-visible:outline-white">
                Invest
              </Button>
            </div>
          </div>
          <p className="relative mt-6 text-sm">
            <Link href="/registry" className="inline-flex min-h-11 items-center gap-1 font-semibold text-blue-50 underline underline-offset-4 hover:text-white focus-visible:outline-white sm:min-h-0">
              See every deal on-chain <span aria-hidden>→</span>
            </Link>
          </p>
        </div>
      </Container>
    </section>
  );
}
