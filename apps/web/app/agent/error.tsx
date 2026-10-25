"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** /agent couldn't render (e.g. the database is unreachable): explain and offer a retry. */
export default function AgentError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-full bg-section px-4 py-12">
      <Card radius="3xl" padding="lg" className="mx-auto max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-600/15 dark:bg-red-500/15 dark:text-red-300">
          <CircleAlert aria-hidden className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-heading">We couldn&apos;t load your card</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Something went wrong on our side. Your money is safe on Stellar; try again in a moment.</p>
        <Button className="mt-6" onClick={() => retry()}>
          Try again
        </Button>
      </Card>
    </div>
  );
}
