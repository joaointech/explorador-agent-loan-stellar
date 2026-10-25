import type { Metadata } from "next";

import { AgentsPanel } from "@/components/admin/agents-panel";
import { requireAdminPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage() {
  await requireAdminPage("/admin/agents");
  return <AgentsPanel />;
}
