import type { Metadata } from "next";
import { RegistryDetail } from "@/components/registry/registry-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Note #${id}`, description: `CPCV Note #${id}: public fields, zero-knowledge proof and timeline. No personal data.` };
}

export default async function RegistryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RegistryDetail id={id} />;
}
