import { ChartLine, Coins, TrendingUp, Wallet } from "lucide-react";

import { Section } from "@/components/ui/layout";
import { StatPill } from "@/components/ui/stat-pill";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";
import { EMPTY_VALUE, formatEur } from "@/lib/format";
import type { PoolStatsResponse } from "@/lib/types/api";

import { apyText } from "./format";
import type { Remote } from "./model";

/** Warm hero band: two-tone headline and the four numbers an investor looks at first. */
export function InvestHero({ stats, showStats }: { stats: Remote<PoolStatsResponse>; showStats: boolean }) {
  const data = stats.data;
  const loading = !data && stats.loading;
  const value = (v: string | undefined) => (data ? v : EMPTY_VALUE);
  return (
    <Section tone="warm" spacing="md" dots>
      <div className="max-w-3xl py-2 sm:py-4">
        <Eyebrow>Invest · Stellar testnet</Eyebrow>
        <TwoToneHeadline as="h1" lead="Earn from agents' advances." accent="Protected by first-loss capital." className="mt-3" />
        <Lead className="mt-4 sm:mt-5">
          Deposit tEURC into the senior vault and receive eaSR shares. Agents pay 12% APR on what they draw against signed deals; you are paid first,
          up to an 8% APY target, and explorador&apos;s junior tranche takes losses before you do.
        </Lead>
      </div>
      {showStats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-8 lg:grid-cols-4">
          <StatPill
            variant="glass"
            tone="primary"
            icon={<TrendingUp />}
            label="Senior APY"
            value={value(data && apyText(data.apy.projectedSenior))}
            hint={data ? `projected · target ${apyText(data.apy.target)}` : "projected"}
            loading={loading}
          />
          <StatPill
            variant="glass"
            icon={<ChartLine />}
            label="7-day trailing"
            value={value(data && (data.apy.trailing7dSenior === null ? EMPTY_VALUE : apyText(data.apy.trailing7dSenior)))}
            hint={data?.apy.trailing7dSenior === null ? "needs a week of history" : "from the share price"}
            loading={loading}
          />
          <StatPill
            variant="glass"
            icon={<Coins />}
            label="Pool TVL"
            value={value(data && formatEur(BigInt(data.stats.seniorAssets) + BigInt(data.stats.juniorAssets), { decimals: 0 }))}
            hint="senior + junior"
            loading={loading}
          />
          <StatPill
            variant="glass"
            icon={<Wallet />}
            label="Available now"
            value={value(data && formatEur(data.stats.lendable, { decimals: 0 }))}
            hint="idle liquidity"
            loading={loading}
          />
        </div>
      )}
    </Section>
  );
}
