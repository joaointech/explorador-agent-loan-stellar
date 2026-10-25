import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { explorerAddressUrl, explorerTxUrl, truncateAddress, truncateHash } from "@/lib/format";

import { cn } from "./cn";
import { CopyButton } from "./copy-button";

/**
 * Stellar address as `CDLZ…4XQA` (spec §10.1) with a copy button and a
 * stellar.expert testnet link. C… addresses (contracts, agent smart accounts)
 * link to the contract page, G… to the account page.
 *
 *   <Address address={note.agent} />
 */
export function Address({
  address,
  head = 4,
  tail = 4,
  full = false,
  copy = true,
  link = true,
  explorerBase,
  label = "address",
  className,
}: {
  address: string;
  head?: number;
  tail?: number;
  /** Show the whole address (wraps on narrow screens). */
  full?: boolean;
  copy?: boolean;
  link?: boolean;
  /** Override the explorer base (DeploymentInfo.explorerBase). */
  explorerBase?: string;
  /** What it is, for accessible names: "smart account", "contract"… */
  label?: string;
  className?: string;
}) {
  const text = full ? address : truncateAddress(address, head, tail);
  const textClass = cn("font-mono text-[0.92em] tracking-tight", full && "break-all");
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 align-middle", className)}>
      {link ? (
        <a
          href={explorerAddressUrl(address, explorerBase)}
          target="_blank"
          rel="noopener noreferrer"
          title={address}
          className={cn(textClass, "rounded text-fg underline decoration-line underline-offset-4 transition-colors hover:text-primary-text hover:decoration-current")}
        >
          {text}
          <span className="sr-only">, view {label} on stellar.expert (opens in a new tab)</span>
        </a>
      ) : (
        <span title={address} className={cn(textClass, "text-fg")}>
          {text}
        </span>
      )}
      {copy && <CopyButton value={address} label={`Copy ${label}`} />}
    </span>
  );
}

/**
 * Link to a transaction on stellar.expert: `a1b2c3…7f8e ↗`, or a custom label
 * such as "View transaction".
 */
export function TxLink({
  hash,
  children,
  explorerBase,
  copy = false,
  className,
}: {
  hash: string;
  children?: ReactNode;
  explorerBase?: string;
  copy?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      <a
        href={explorerTxUrl(hash, explorerBase)}
        target="_blank"
        rel="noopener noreferrer"
        title={hash}
        className="inline-flex items-center gap-0.5 rounded font-medium text-primary-text underline-offset-4 hover:underline"
      >
        {children ?? <span className="font-mono text-[0.92em] tracking-tight">{truncateHash(hash)}</span>}
        <ArrowUpRight aria-hidden className="size-3.5" />
        <span className="sr-only"> (transaction on stellar.expert, opens in a new tab)</span>
      </a>
      {copy && <CopyButton value={hash} label="Copy transaction hash" />}
    </span>
  );
}
