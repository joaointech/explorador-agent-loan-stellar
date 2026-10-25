// /agent: the agent app (spec §4.2, §4.4–4.6, §10.2), mobile first. The
// overview is rendered on the server (streamed behind a skeleton while the
// chain is read), then the client keeps it fresh by polling
// /api/agent/overview every ~10 s and after every action.

import type { Metadata } from "next";
import { Suspense } from "react";

import { AgentApp } from "@/components/agent/agent-app";
import { AgentSkeleton } from "@/components/agent/skeleton";
import { loadAgentOverview } from "@/lib/agent/overview";
import { requireAgentPage } from "@/lib/auth/page";

export const metadata: Metadata = {
  title: "Agent",
  description: "Your explorador advance card: spend your commission before the escritura.",
  robots: { index: false },
};

async function AgentOverview({ userId }: { userId: string }) {
  const initial = await loadAgentOverview(userId);
  return <AgentApp initial={initial} />;
}

export default async function AgentPage() {
  const user = await requireAgentPage("/agent");
  return (
    <div className="min-h-full bg-section">
      <Suspense fallback={<AgentSkeleton />}>
        <AgentOverview userId={user.userId} />
      </Suspense>
    </div>
  );
}
