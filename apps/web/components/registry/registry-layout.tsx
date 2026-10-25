import type { ReactNode } from "react";

import { Container } from "@/components/ui/layout";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";

/** Page title block of /registry (spec §10.2). */
export function RegistryHeading() {
  return (
    <div className="max-w-3xl">
      <Eyebrow>Public registry</Eyebrow>
      <div id="registry-title">
        <TwoToneHeadline as="h1" lead="Every deal, on-chain." accent="No personal data." className="mt-3" />
      </div>
      <Lead className="mt-4 sm:mt-5">
        Every CPCV Note explorador mints is listed here, read straight from the note contract on Stellar testnet: commissions, escritura
        dates and status, each backed by a zero-knowledge proof you can verify yourself. Agents appear by address only.
      </Lead>
    </div>
  );
}

/** Warm header band (title + counts), then the explainer and the notes on white. */
export function RegistryLayout({ counts, explainer, children }: { counts: ReactNode; explainer: ReactNode; children: ReactNode }) {
  return (
    <>
      <section aria-labelledby="registry-title" className="relative overflow-clip bg-section">
        <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
        <Container className="relative py-10 sm:py-14">
          <RegistryHeading />
          <div className="mt-8 sm:mt-10">{counts}</div>
        </Container>
      </section>
      <div className="py-8 sm:py-12">
        <Container>
          {explainer}
          <section aria-labelledby="notes-title" className="mt-10 sm:mt-12">
            {children}
          </section>
        </Container>
      </div>
    </>
  );
}
