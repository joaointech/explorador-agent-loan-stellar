import type { Metadata } from "next";

import { InvestPreview } from "@/components/invest/invest-preview";
import { isPreviewState } from "@/components/invest/preview-states";

export const metadata: Metadata = {
  title: "Invest preview",
  description: "The investor dashboard in every state (wallet, network, deployment), rendered with mocked data.",
  robots: { index: false },
};

/** /invest/preview?state=…: the dashboard with fixtures and simulated actions (nothing is signed or sent). */
export default async function InvestPreviewPage({ searchParams }: PageProps<"/invest/preview">) {
  const { state } = await searchParams;
  return <InvestPreview state={isPreviewState(state) ? state : "connected-position"} />;
}
