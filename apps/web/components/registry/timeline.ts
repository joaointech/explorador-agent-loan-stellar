// Note timeline (spec §10.2 /registry/[id]): indexed contract events → plain
// English. Event data uses the indexer's camelCase field names; amounts are
// stroops as decimal strings.

import { formatDate, formatEur } from "@/lib/format";
import type { TimelineEvent } from "@/lib/types/api";

export type TimelineTone = "blue" | "emerald" | "amber" | "red" | "neutral";
export type TimelineIcon = "mint" | "line" | "draw" | "settle" | "cancel" | "writeoff" | "event";

export interface TimelineItem {
  key: string;
  title: string;
  description: string | null;
  /** Protocol-clock unix seconds, when known. */
  at: number | null;
  txHash: string;
  ledger: number;
  tone: TimelineTone;
  icon: TimelineIcon;
}

type Data = Record<string, unknown>;

/** A stroops amount from event data, or null when absent or malformed. */
function amount(data: Data, key: string): bigint | null {
  const v = data[key];
  if (typeof v === "bigint") return v;
  if ((typeof v === "string" && /^-?\d+$/.test(v)) || (typeof v === "number" && Number.isInteger(v))) return BigInt(v);
  return null;
}

const money = (data: Data, key: string) => {
  const v = amount(data, key);
  return v === null ? null : formatEur(v);
};

function joinParts(parts: (string | null | false)[]): string | null {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return kept.length > 0 ? kept.join(" · ") : null;
}

/** "NoteStatusChanged" → "Note status changed". */
export function humanizeType(type: string): string {
  const words = type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function describeTimelineEvent(event: TimelineEvent, index = 0): TimelineItem {
  const data: Data = event.data ?? {};
  const base = { key: `${event.txHash}:${event.type}:${index}`, at: event.at, txHash: event.txHash, ledger: event.ledger };

  switch (event.type) {
    case "NoteMinted":
      return {
        ...base,
        title: "Note minted",
        description: "Proof verified on Stellar; the soulbound note was minted to the agent's account.",
        tone: "blue",
        icon: "mint",
      };
    case "LineOpened": {
      const limit = money(data, "creditLimit");
      return {
        ...base,
        title: "Credit line opened",
        description: limit ? `${limit} of credit for the agent's card (50% of their commission).` : "Credit for the agent's card (50% of their commission).",
        tone: "blue",
        icon: "line",
      };
    }
    case "CardDraw": {
      const onNote = money(data, "attributedToNote");
      const purchase = money(data, "amount");
      const fromBalance = amount(data, "fromBalance");
      return {
        ...base,
        title: "Card purchase on credit",
        description: joinParts([
          onNote && `${onNote} borrowed against this note`,
          purchase && onNote !== purchase && `purchase ${purchase}`,
          fromBalance !== null && fromBalance > 0n && `${formatEur(fromBalance)} from card balance`,
        ]),
        tone: "neutral",
        icon: "draw",
      };
    }
    case "NoteSettled": {
      const repaid = money(data, "debtRepaid");
      const interest = money(data, "interestPaid");
      const carried = amount(data, "carriedRepaid");
      return {
        ...base,
        title: "Escritura confirmed",
        description: joinParts([
          money(data, "totalCommission") && `${money(data, "totalCommission")} paid in`,
          repaid && `${repaid} debt repaid${interest ? ` (incl. ${interest} interest)` : ""}`,
          carried !== null && carried > 0n && `${formatEur(carried)} carried debt repaid`,
          money(data, "agentPayout") && `${money(data, "agentPayout")} to the agent's card balance`,
          money(data, "juniorDeposit") && `${money(data, "juniorDeposit")} to the first-loss tranche`,
        ]),
        tone: "emerald",
        icon: "settle",
      };
    }
    case "NoteCancelled": {
      const deadline = amount(data, "graceDeadline");
      return {
        ...base,
        title: "Deal cancelled: buyer withdrew",
        description: joinParts([
          money(data, "debtCarried") && `${money(data, "debtCarried")} of debt carried to the agent's next deals`,
          deadline !== null && deadline > 0n && `grace period until ${formatDate(Number(deadline))}`,
        ]),
        tone: "amber",
        icon: "cancel",
      };
    }
    case "DebtWrittenOff":
      return {
        ...base,
        title: "Debt written off",
        description: joinParts([
          money(data, "amount") && `${money(data, "amount")} written off`,
          money(data, "juniorLoss") && `${money(data, "juniorLoss")} from the first-loss tranche`,
          money(data, "seniorLoss") && `${money(data, "seniorLoss")} from senior`,
        ]),
        tone: "red",
        icon: "writeoff",
      };
    default:
      return { ...base, title: humanizeType(event.type), description: null, tone: "neutral", icon: "event" };
  }
}

/** Oldest first, as the API sends them; stable for equal ledgers. */
export function describeTimeline(events: readonly TimelineEvent[]): TimelineItem[] {
  return events.map((e, i) => describeTimelineEvent(e, i));
}
