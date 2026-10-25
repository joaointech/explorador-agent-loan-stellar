"use client";

import type { AgentOverviewResponse } from "@/lib/types/api";

import { AgentDashboard } from "./agent-dashboard";
import { httpAgentApi } from "./api";
import { AgentAppProvider } from "./context";
import { useAgentOverview } from "./use-agent-overview";

/** /agent: the server-rendered overview, kept fresh by polling /api/agent/overview. */
export function AgentApp({ initial }: { initial: AgentOverviewResponse }) {
  const { data, error, refreshing, refresh } = useAgentOverview(initial, httpAgentApi);
  return (
    <AgentAppProvider value={{ api: httpAgentApi, refresh, preview: false }}>
      <AgentDashboard data={data} status={{ error, refreshing }} />
    </AgentAppProvider>
  );
}
