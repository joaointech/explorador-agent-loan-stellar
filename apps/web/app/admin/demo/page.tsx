import type { Metadata } from "next";

import { DemoPanel } from "@/components/admin/demo-panel";
import { requireAdminPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "Demo" };

export default async function DemoPage() {
  await requireAdminPage("/admin/demo");
  return <DemoPanel />;
}
