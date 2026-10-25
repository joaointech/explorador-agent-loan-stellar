// /agent/preview: every agent-app state rendered from mocked overviews
// (components/agent/fixtures.ts), for design review and demos. Purchases run
// against a fake API; passkey actions are disabled. Dev and demo deployments
// only (DEMO_MODE); `?state=carriedDebt` opens a given state.

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isAgentFixtureName } from "@/components/agent/fixtures";
import { AgentPreviewGallery } from "@/components/agent/preview-gallery";
import { requireAgentPage } from "@/lib/auth/page";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Agent app states",
  robots: { index: false },
};

export default async function AgentPreviewPage({ searchParams }: PageProps<"/agent/preview">) {
  if (process.env.NODE_ENV === "production" && !env().DEMO_MODE) notFound();
  await requireAgentPage("/agent/preview");
  const { state } = await searchParams;
  const initial = Array.isArray(state) ? state[0] : state;
  return (
    <div className="min-h-full bg-section">
      <AgentPreviewGallery initial={isAgentFixtureName(initial) ? initial : undefined} />
    </div>
  );
}
