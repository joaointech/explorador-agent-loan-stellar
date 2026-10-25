import type { Metadata } from "next";

import { AdminNav } from "@/components/admin/admin-nav";
import { Container } from "@/components/ui/layout";
import { Eyebrow } from "@/components/ui/typography";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · explorador advance" },
  robots: { index: false },
};

// Each page checks the session itself (requireAdminPage) so a signed-out
// visitor comes back to the exact page after signing in; proxy.ts has already
// redirected anyone without an admin cookie.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <div className="border-b border-line bg-section">
        <Container className="pt-6 sm:pt-8">
          <Eyebrow>Admin panel · explorador staff</Eyebrow>
          <AdminNav className="mt-3" />
        </Container>
      </div>
      <Container className="py-8 sm:py-10">{children}</Container>
    </>
  );
}
