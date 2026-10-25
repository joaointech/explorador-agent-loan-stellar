import type { Metadata } from "next";

import { OverviewPanel } from "@/components/admin/overview-panel";
import { requireAdminPage } from "@/lib/auth/page";

// Same segment as app/admin/layout.tsx, whose title template only applies to child segments.
export const metadata: Metadata = { title: "Admin overview" };

export default async function AdminOverviewPage() {
  await requireAdminPage("/admin");
  return <OverviewPanel />;
}
