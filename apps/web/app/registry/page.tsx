import type { Metadata } from "next";
import { RegistryApp } from "@/components/registry/registry-app";

export const metadata: Metadata = {
  title: "Registry",
  description: "Every CPCV Note on Stellar testnet, with its zero-knowledge proof. No personal data.",
};

export default function RegistryPage() {
  return <RegistryApp />;
}
