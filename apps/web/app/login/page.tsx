import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginFlow } from "@/components/login-flow";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <section className="relative min-h-[calc(100dvh-64px)] overflow-hidden bg-warm">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative mx-auto flex max-w-md flex-col px-4 py-10 sm:py-16">
        <Suspense fallback={null}>
          <LoginFlow />
        </Suspense>
      </div>
    </section>
  );
}
