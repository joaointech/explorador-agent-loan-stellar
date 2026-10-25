import type { Metadata } from "next";
import { Suspense } from "react";

import { RegistryExplorer, RegistryExplorerFallback } from "@/components/registry/registry-explorer";
import { TrustModel } from "@/components/registry/trust-model";

export const metadata: Metadata = {
  title: "Registry",
  description:
    "Every CPCV Note explorador advance has minted on Stellar testnet: commissions, escritura dates, status and the zero-knowledge proof behind each deal. No personal data.",
};

// Public registry (spec §10.2 /registry). The notes are read in the browser
// from GET /api/registry; status and search live in the URL (?status=&q=).
export default function RegistryPage() {
  const explainer = <TrustModel />;
  return (
    <Suspense fallback={<RegistryExplorerFallback explainer={explainer} />}>
      <RegistryExplorer explainer={explainer} />
    </Suspense>
  );
}
