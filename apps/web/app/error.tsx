"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-start px-4 py-24">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="h3 mt-2">This page hit an error.</h1>
      <p className="mt-3 text-sm text-muted">{error.message || "Unexpected error."}</p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
