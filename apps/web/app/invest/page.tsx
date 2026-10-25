import type { Metadata } from "next";

import { InvestDashboard } from "@/components/invest/invest-dashboard";

export const metadata: Metadata = {
  title: "Invest",
  description:
    "Deposit tEURC into the explorador advance senior vault on Stellar testnet and earn the interest agents pay on commission advances, protected by explorador's first-loss capital.",
};

/** Investor dashboard (spec §10.2 /invest): Freighter, position, deposit/withdraw, pool health, history, how yield works. */
export default function InvestPage() {
  return <InvestDashboard />;
}
