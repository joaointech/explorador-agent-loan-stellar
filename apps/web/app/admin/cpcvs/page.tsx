import type { Metadata } from "next";

import { CpcvsPanel } from "@/components/admin/cpcvs-panel";
import { requireAdminPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "CPCVs" };

export default async function CpcvsPage() {
  await requireAdminPage("/admin/cpcvs");
  return <CpcvsPanel />;
}
