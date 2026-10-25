"use client";

import { ArrowLeft, FileQuestionMark } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { useDemoClock } from "@/components/shell/demo-clock";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Container } from "@/components/ui/layout";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import type { RegistryDetailResponse } from "@/lib/types/api";

import { LoadError } from "./load-error";
import { NoteDetailView } from "./note-detail-view";
import { noteApiUrl } from "./registry-query";
import { useApiResource } from "./use-api-resource";

/** Warm title band shared by the loading, not-found and error states. */
function TitleBand({ id, children }: { id: number; children?: ReactNode }) {
  return (
    <section aria-labelledby="note-title" className="relative overflow-clip bg-section">
      <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
      <Container className="relative py-8 sm:py-12">
        <Link
          href="/registry"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted transition-colors hover:text-primary-text"
        >
          <ArrowLeft aria-hidden className="size-4" />
          All notes
        </Link>
        <h1 id="note-title" className="mt-3 font-display text-3xl font-bold tracking-tight text-heading sm:text-4xl">
          Note #{id}
        </h1>
        {children}
      </Container>
    </section>
  );
}

function DetailSkeleton({ id }: { id: number }) {
  return (
    <div aria-busy>
      <TitleBand id={id}>
        <p role="status" className="sr-only">
          Loading note #{id}…
        </p>
        <Skeleton className="mt-4 h-5 w-72 max-w-full" />
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-card" />
          ))}
        </div>
      </TitleBand>
      <Container className="py-8 sm:py-12">
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded-panel border border-line bg-card p-5 shadow-card sm:p-7">
              <Skeleton className="h-6 w-1/2" />
              <SkeletonText lines={3} className="mt-4" />
              <Skeleton className="mt-6 h-12 w-40 rounded-xl" />
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}

/** /registry/[id]: fetches GET /api/registry/[id] and renders the note, or a not-found / error state. */
export function NoteDetail({ id }: { id: number }) {
  const detail = useApiResource<RegistryDetailResponse>(noteApiUrl(id));
  const clock = useDemoClock();

  if (detail.status === "loading") return <DetailSkeleton id={id} />;

  if (detail.status === "error") {
    // A JSON 404 from the API means the note doesn't exist; an HTML 404 means the route isn't deployed.
    const missing = detail.error.notFound && detail.error.code !== "HTTP_404";
    return (
      <>
        <TitleBand id={id} />
        <Container className="py-8 sm:py-12">
          {missing ? (
            <EmptyState
              icon={<FileQuestionMark />}
              title={`Note #${id} doesn't exist`}
              description="No CPCV Note with this number has been minted on the current deployment. Notes are numbered from 1."
              action={
                <Button href="/registry" variant="secondary" size="sm" arrow>
                  Browse the registry
                </Button>
              }
            />
          ) : (
            <LoadError title={`Couldn't load note #${id}`} error={detail.error} onRetry={detail.retry} />
          )}
        </Container>
      </>
    );
  }

  return <NoteDetailView detail={detail.data} protocolNow={clock?.clock.protocolNow ?? null} />;
}
