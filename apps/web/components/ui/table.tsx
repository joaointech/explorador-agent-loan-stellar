import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "./cn";

/**
 * Table building blocks. The container scrolls horizontally inside its own
 * rounded card, so wide tables never make the page scroll at 375 px.
 *
 *   <TableContainer>
 *     <Table>
 *       <TableHeader><TableRow><TableHead>Note</TableHead>…</TableRow></TableHeader>
 *       <TableBody><TableRow><TableCell>#12</TableCell>…</TableRow></TableBody>
 *     </Table>
 *   </TableContainer>
 */
export function TableContainer({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-card border border-line bg-card shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-left text-sm tabular-nums", className)} {...rest} />;
}

export function TableCaption({ className, ...rest }: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("px-4 py-3 text-left text-sm text-muted", className)} {...rest} />;
}

export function TableHeader({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-card-muted", className)} {...rest} />;
}

export function TableBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-line", className)} {...rest} />;
}

export function TableRow({ className, interactive, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(interactive && "cursor-pointer transition-colors hover:bg-primary-tint/60 focus-within:bg-primary-tint/60", className)}
      {...rest}
    />
  );
}

type Align = "left" | "right" | "center";
const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

export function TableHead({ className, align = "left", ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-4 py-3 text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap text-muted uppercase",
        ALIGN[align],
        className,
      )}
      {...rest}
    />
  );
}

export function TableCell({ className, align = "left", ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return <td className={cn("px-4 py-3 align-middle whitespace-nowrap text-fg", ALIGN[align], className)} {...rest} />;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: Align;
  className?: string;
  /** Hide on narrow screens (the column stays in the DOM for larger ones). */
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE: Record<NonNullable<Column<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

/**
 * Typed table from a column list. Server-compatible (no client JS).
 *
 *   <DataTable
 *     rows={notes}
 *     rowKey={(n) => n.id}
 *     columns={[
 *       { key: "id", header: "Note", cell: (n) => <Link href={`/registry/${n.id}`}>#{n.id}</Link> },
 *       { key: "agent", header: "Agent", cell: (n) => <Address address={n.agent} /> },
 *       { key: "total", header: "Commission", align: "right", cell: (n) => <Amount value={n.totalCommission} /> },
 *       { key: "status", header: "Status", cell: (n) => <StatusBadge status={n.status} /> },
 *     ]}
 *     empty={<EmptyState variant="plain" title="No notes yet" />}
 *   />
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  caption?: ReactNode;
  /** Rendered in a full-width row when `rows` is empty. */
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <TableContainer className={className}>
      <Table>
        {caption && <TableCaption>{caption}</TableCaption>}
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} align={c.align} className={cn(c.hideBelow && HIDE[c.hideBelow])}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty ?? <p className="px-4 py-10 text-center text-sm text-muted">Nothing here yet.</p>}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c) => (
                  <TableCell key={c.key} align={c.align} className={cn(c.hideBelow && HIDE[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
