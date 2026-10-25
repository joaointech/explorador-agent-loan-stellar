import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/layout";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";

import { HeroVisual } from "./hero-visual";
import { PoolStatPills } from "./pool-stat-pills";

/** Landing hero (spec §10.2 "/"): warm band with the dotted grid, as on explorador.pt. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-clip bg-section">
      <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
      <Container className="relative py-10 sm:py-14 lg:py-16">
        <div className="grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr] xl:gap-16">
          <div className="max-w-2xl">
            <Eyebrow>explorador advance</Eyebrow>
            <div id="hero-title">
              <TwoToneHeadline as="h1" size="display" accentStyle="gradient" lead="Close the deal." accent="Get paid today." className="mt-4" />
            </div>
            <Lead className="mt-5 sm:mt-6">
              Agents close the deal when the CPCV is signed, then wait months for the escritura to get paid. explorador advance turns
              that signed CPCV into credit the same day, spent by card. Investors fund the advances from a pool on Stellar and earn the
              interest.
            </Lead>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button href="/agent" size="lg" arrow>
                I&apos;m an agent
              </Button>
              <Button href="/invest" size="lg" variant="secondary" arrow>
                Invest
              </Button>
            </div>
            <p className="mt-5 text-center sm:text-left">
              <Link
                href="/registry"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text underline-offset-4 hover:underline sm:min-h-0"
              >
                See every deal on-chain <span aria-hidden>→</span>
              </Link>
            </p>
          </div>
          <HeroVisual className="hidden lg:block" />
        </div>
        <PoolStatPills className="mt-10 sm:mt-12" />
      </Container>
    </section>
  );
}
