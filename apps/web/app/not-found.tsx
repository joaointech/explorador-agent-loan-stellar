import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="relative overflow-hidden bg-warm">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative mx-auto flex max-w-3xl flex-col items-start px-4 py-24">
        <p className="eyebrow">404</p>
        <h1 className="h2 mt-2">
          <span className="block">This page</span>
          <span className="block text-primary">isn&apos;t on-chain.</span>
        </h1>
        <p className="mt-4 text-ink-soft">The page you are looking for does not exist.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Home →</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/registry">See the registry →</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
