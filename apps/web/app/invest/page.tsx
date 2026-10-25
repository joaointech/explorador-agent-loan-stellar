import type { Metadata } from "next";
import { InvestApp } from "@/components/invest/invest-app";

export const metadata: Metadata = { title: "Invest" };

export default function InvestPage() {
  return <InvestApp />;
}
