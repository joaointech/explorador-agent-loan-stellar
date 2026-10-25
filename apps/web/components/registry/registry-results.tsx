import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Address, TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { StatusBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { DateText } from "@/components/ui/date-text";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RegistryNote } from "@/lib/types/api";

import { noteHref } from "./registry-query";

/** Status badge plus the Overdue outline badge (spec §2: protocol date past the escritura date). */
export function NoteStatus({ note, size = "sm" }: { note: Pick<RegistryNote, "status" | "overdue">; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <StatusBadge status={note.status} size={size} />
      {note.overdue && <StatusBadge status="Overdue" size={size} />}
    </span>
  );
}

function Minted({ note, stacked = false }: { note: RegistryNote; stacked?: boolean }) {
  return (
    <span className={cn("inline-flex gap-x-2 gap-y-0.5", stacked ? "flex-col items-start" : "flex-wrap items-center")}>
      <DateText value={note.mintedAt} />
      {note.mintTxHash ? <TxLink hash={note.mintTxHash} className="text-xs" /> : null}
    </span>
  );
}

function NoteLink({ id, className, children }: { id: number; className?: string; children?: ReactNode }) {
  return (
    <Link href={noteHref(id)} className={cn("rounded font-bold text-heading underline-offset-4 hover:text-primary-text hover:underline", className)}>
      {children ?? `#${id}`}
    </Link>
  );
}

/** Wide screens: one row per note. */
function NotesTable({ notes, caption }: { notes: RegistryNote[]; caption: string }) {
  return (
    <TableContainer className="hidden md:block">
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="px-3 pl-5">Note</TableHead>
            <TableHead className="px-3">Agent</TableHead>
            <TableHead className="px-3" align="right">
              Total commission
            </TableHead>
            <TableHead className="hidden px-3 xl:table-cell" align="right">
              Agent commission
            </TableHead>
            <TableHead className="px-3" align="right">
              Credit limit
            </TableHead>
            <TableHead className="px-3">Escritura</TableHead>
            <TableHead className="px-3">Status</TableHead>
            <TableHead className="hidden px-3 lg:table-cell">Minted</TableHead>
            <TableHead className="w-10 px-3 pr-5">
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notes.map((n) => (
            <TableRow key={n.id} className="transition-colors hover:bg-primary-tint/50">
              <TableCell className="px-3 pl-5">
                <NoteLink id={n.id} />
              </TableCell>
              <TableCell className="px-3">
                <Address address={n.agent} label="agent smart account" />
              </TableCell>
              <TableCell className="px-3 font-semibold text-heading" align="right">
                <Amount value={n.totalCommission} />
              </TableCell>
              <TableCell className="hidden px-3 xl:table-cell" align="right">
                <Amount value={n.agentCommission} />
              </TableCell>
              <TableCell className="px-3" align="right">
                <Amount value={n.creditLimit} />
              </TableCell>
              <TableCell className="px-3">
                <DateText value={n.escrituraDay} />
              </TableCell>
              <TableCell className="px-3">
                <NoteStatus note={n} />
              </TableCell>
              <TableCell className="hidden px-3 lg:table-cell">
                <Minted note={n} stacked />
              </TableCell>
              <TableCell className="px-3 pr-5" align="right">
                <Link
                  href={noteHref(n.id)}
                  aria-label={`Note #${n.id} details`}
                  className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-primary-tint hover:text-primary-text"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-heading">{children}</dd>
    </div>
  );
}

/** Phones: one card per note. */
function NoteCards({ notes, caption }: { notes: RegistryNote[]; caption: string }) {
  return (
    <ul aria-label={caption} className="flex flex-col gap-3 md:hidden">
      {notes.map((n) => (
        <li key={n.id} className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base">
              <NoteLink id={n.id}>Note #{n.id}</NoteLink>
            </h3>
            <NoteStatus note={n} />
          </div>
          <dl className="mt-2 divide-y divide-line text-sm">
            <CardRow label="Agent">
              <Address address={n.agent} label="agent smart account" />
            </CardRow>
            <CardRow label="Total commission">
              <Amount value={n.totalCommission} className="font-semibold" />
            </CardRow>
            <CardRow label="Agent commission">
              <Amount value={n.agentCommission} />
            </CardRow>
            <CardRow label="Credit limit">
              <Amount value={n.creditLimit} />
            </CardRow>
            <CardRow label="Escritura">
              <DateText value={n.escrituraDay} />
            </CardRow>
            <CardRow label="Minted">
              <Minted note={n} />
            </CardRow>
          </dl>
          <Link
            href={noteHref(n.id)}
            className="mt-3 flex min-h-11 items-center justify-center gap-1 rounded-button bg-card-muted text-sm font-semibold text-primary-text ring-1 ring-line transition-colors hover:bg-primary-tint"
          >
            Proof and timeline <span aria-hidden>→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Registry results: a table from md up, cards on phones (spec §10.2). */
export function RegistryResults({ notes, caption = "CPCV Notes, newest first" }: { notes: RegistryNote[]; caption?: string }) {
  return (
    <>
      <NotesTable notes={notes} caption={caption} />
      <NoteCards notes={notes} caption={caption} />
    </>
  );
}

/** Placeholder rows and cards while the registry loads. */
export function RegistryResultsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <div className="hidden overflow-hidden rounded-card border border-line bg-card shadow-card md:block">
        <div className="h-11 border-b border-line bg-card-muted" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-line px-5 py-4 last:border-0">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-card border border-line bg-card p-4 shadow-card">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
