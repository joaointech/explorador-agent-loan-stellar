import { CtaBand } from "@/components/landing/cta-band";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { TrustSection } from "@/components/landing/trust-section";

// Landing (spec §10.2 "/"): hero with live pool numbers, how it works with the
// spec §5.6 worked example, the trust section and a closing call to action.
// Static apart from the stat pills, which read GET /api/pool/stats in the browser.
export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <TrustSection />
      <CtaBand />
    </>
  );
}
