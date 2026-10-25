import type { Metadata } from "next";

import { NewCpcvPanel } from "@/components/admin/new-cpcv";
import { requireAdminPage } from "@/lib/auth/page";

export const metadata: Metadata = { title: "New CPCV" };

export default async function NewCpcvPage() {
  await requireAdminPage("/admin/cpcvs/new");
  return <NewCpcvPanel />;
}
