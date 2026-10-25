import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/layout";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";

// Placeholder landing: the real page (spec §10.2 "/") is built by the landing
// workstream. It only shows the shell and the hero pattern from /design.
export default function Home() {
  return (
    <Section tone="warm" spacing="lg" dots>
      <div className="max-w-3xl py-6 sm:py-10">
        <Eyebrow>explorador advance</Eyebrow>
        <TwoToneHeadline as="h1" size="display" accentStyle="gradient" lead="Close the deal." accent="Get paid today." className="mt-4" />
        <Lead className="mt-5 sm:mt-6">
          Agents spend part of their commission the day the CPCV is signed, backed by a zero-knowledge proof on
          Stellar. Investors fund the advances and earn the interest.
        </Lead>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button href="/agent" size="lg" arrow>
            I&apos;m an agent
          </Button>
          <Button href="/invest" size="lg" variant="secondary" arrow>
            Invest
          </Button>
        </div>
        <p className="mt-5">
          <Link href="/registry" className="text-sm font-medium text-primary-text underline-offset-4 hover:underline">
            See every deal on-chain →
          </Link>
        </p>
      </div>
    </Section>
  );
}
