"use client";

import { Coins, Landmark } from "lucide-react";
import { useState } from "react";

import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardRow } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { formatEur, parseEurToCents, toDecimalString } from "@/lib/format";
import type { Jsonify, PoolStats } from "@/lib/types/chain";
import type { TxResponse } from "@/lib/types/api";
import { STROOPS_PER_CENT } from "@/lib/units";

import { postAdmin, toAdminApiError } from "./api";

type Stats = Jsonify<PoolStats>;

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const atLeastZero = (x: bigint) => (x < 0n ? 0n : x);

/** Most the treasury can take out of junior now: ≤ junior, ≤ idle liquidity, and debt must stay ≤ max_leverage × junior. */
export function maxJuniorWithdraw(stats: Stats): bigint {
  const junior = BigInt(stats.juniorAssets);
  const leverage = BigInt(stats.params.maxLeverage);
  const debt = BigInt(stats.totalDebt);
  const juniorNeeded = leverage > 0n ? (debt + leverage - 1n) / leverage : junior;
  return atLeastZero(min(junior, BigInt(stats.lendable), junior - juniorNeeded));
}

/** Protocol fees claimable now: ≤ fees accrued and ≤ pool cash. */
export const claimableFees = (stats: Stats): bigint => atLeastZero(min(BigInt(stats.feesAccrued), BigInt(stats.poolCash)));

/** Stroops → editable euros, rounded down to the cent ("1234.56"). */
const toEurInput = (stroops: bigint) => toDecimalString(stroops / STROOPS_PER_CENT, 2);

/**
 * A limit rounded down to the cent: what "Max" fills in and the most a form can send.
 * Shown that way so the hint, the over-limit error and Max agree (a €57.2381 limit
 * reads €57.23, not €57.24, which the form would reject as "more than €57.24").
 */
export const floorToCent = (stroops: bigint): bigint => (stroops / STROOPS_PER_CENT) * STROOPS_PER_CENT;

function AmountAction({
  label,
  action,
  endpoint,
  max,
  maxLabel,
  successTitle,
  onDone,
}: {
  label: string;
  action: string;
  endpoint: string;
  /** Upper bound shown as a hint and used by "Max" (null = no known bound). */
  max: bigint | null;
  maxLabel: string;
  successTitle: (amount: string) => string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = parseEurToCents(value);
  const stroops = cents === null ? null : cents * STROOPS_PER_CENT;
  const overMax = max !== null && stroops !== null && stroops > max;
  const shownMax = max === null ? null : floorToCent(max);
  const invalid = cents === null || cents <= 0n;

  const submit = async () => {
    if (invalid || cents === null) return;
    setPending(true);
    setError(null);
    try {
      const res = await postAdmin<TxResponse>(endpoint, { amountEur: Number(cents) / 100 });
      toast.success(successTitle(formatEur(cents, { unit: "cents" })), { action: { label: "View transaction", href: res.explorerUrl } });
      setValue("");
      onDone();
    } catch (err) {
      setError(toAdminApiError(err).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field
        label={label}
        error={error ?? (overMax ? `That is more than the ${maxLabel} (${formatEur(shownMax!)})` : undefined)}
        hint={shownMax !== null ? `${maxLabel[0].toUpperCase()}${maxLabel.slice(1)}: ${formatEur(shownMax)}` : undefined}
      >
        <NumberInput value={value} onValueChange={setValue} decimals={2} prefix="€" placeholder="0.00" disabled={pending} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={pending} disabled={invalid}>
          {action}
        </Button>
        {shownMax !== null && shownMax > 0n && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setValue(toEurInput(shownMax))} disabled={pending}>
            Max
          </Button>
        )}
      </div>
    </form>
  );
}

/** Junior (first-loss) tranche: explorador's capital; deposit or withdraw as treasury. */
export function JuniorTrancheCard({ stats, onDone }: { stats: Stats | null; onDone: () => void }) {
  return (
    <Card className="flex flex-col gap-5">
      <CardHeader
        eyebrow="Treasury"
        title={
          <span className="inline-flex items-center gap-2">
            <Landmark aria-hidden className="size-5 text-primary-text" /> Junior tranche
          </span>
        }
        description="explorador's first-loss capital. It takes losses before senior investors and caps total debt at 10× its size."
      />
      <div className="rounded-xl border border-line px-4 py-1">
        <CardRow label="Junior assets" value={<Amount value={stats?.juniorAssets} />} />
        <CardRow label="Outstanding debt" value={<Amount value={stats?.totalDebt} />} />
      </div>
      <Tabs defaultValue="deposit">
        <TabsList aria-label="Junior tranche action">
          <TabsTrigger value="deposit">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
        </TabsList>
        <TabsContent value="deposit">
          <AmountAction
            label="Amount to deposit"
            action="Deposit from treasury"
            endpoint="/api/admin/junior/deposit"
            max={null}
            maxLabel="treasury balance"
            successTitle={(a) => `${a} added to the junior tranche`}
            onDone={onDone}
          />
        </TabsContent>
        <TabsContent value="withdraw">
          <AmountAction
            label="Amount to withdraw"
            action="Withdraw to treasury"
            endpoint="/api/admin/junior/withdraw"
            max={stats ? maxJuniorWithdraw(stats) : null}
            maxLabel="most you can withdraw now"
            successTitle={(a) => `${a} withdrawn from the junior tranche`}
            onDone={onDone}
          />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

/** Protocol fees (10% of interest), claimable by the treasury. */
export function FeesCard({ stats, onDone }: { stats: Stats | null; onDone: () => void }) {
  return (
    <Card className="flex flex-col gap-5">
      <CardHeader
        eyebrow="Treasury"
        title={
          <span className="inline-flex items-center gap-2">
            <Coins aria-hidden className="size-5 text-primary-text" /> Protocol fees
          </span>
        }
        description="10% of the interest agents pay. Claiming moves it from the pool to the treasury."
      />
      <div className="rounded-xl border border-line px-4 py-1">
        <CardRow label="Fees accrued" value={<Amount value={stats?.feesAccrued} />} />
        <CardRow label="Claimable now" value={<Amount value={stats ? floorToCent(claimableFees(stats)).toString() : null} />} />
      </div>
      <AmountAction
        label="Amount to claim"
        action="Claim fees"
        endpoint="/api/admin/fees/claim"
        max={stats ? claimableFees(stats) : null}
        maxLabel="fees claimable now"
        successTitle={(a) => `${a} of protocol fees claimed`}
        onDone={onDone}
      />
    </Card>
  );
}
