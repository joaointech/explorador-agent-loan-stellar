import type { Metadata } from "next";
import { AgentApp } from "@/components/agent/agent-app";

export const metadata: Metadata = { title: "Agent" };

export default function AgentPage() {
  return <AgentApp />;
}
