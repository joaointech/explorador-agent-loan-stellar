// GET /api/investor/[address] read model (spec §9.7): eaSR position from the
// contract, deposit/withdraw history from indexed SEP-56 events.

import { dataBigInt, parseCloseTime, EventType } from "@/lib/indexer/events";
import { loadVaultHistory } from "@/lib/indexer/queries";
import { readMaxWithdraw, readShareBalance } from "@/lib/stellar/contracts";
import { requireDeployment } from "@/lib/stellar/deployment";
import type { InvestorHistoryItem, InvestorResponse } from "@/lib/types/api";
import type { PoolStats } from "@/lib/types/chain";

import { getPoolStatsCached } from "./stats-cache";

/** SEP-56 `convert_to_assets` with the vault math of spec §5.5 (rounds down). */
export const convertToAssets = (shares: bigint, stats: Pick<PoolStats, "seniorAssets" | "shareSupply">): bigint =>
  (shares * (stats.seniorAssets + 1n)) / (stats.shareSupply + 1n);

export async function getInvestorResponse(address: string): Promise<InvestorResponse> {
  const deployment = await requireDeployment();
  const [shares, stats, maxWithdraw, events] = await Promise.all([
    readShareBalance(address),
    getPoolStatsCached(),
    readMaxWithdraw(address),
    loadVaultHistory(deployment.info.advancePool, address),
  ]);

  let deposited = 0n;
  let withdrawn = 0n;
  const history: InvestorHistoryItem[] = events.map((e) => {
    const assets = dataBigInt(e.data, "assets") ?? 0n;
    const type = e.type === EventType.Deposit ? "deposit" : "withdraw";
    if (type === "deposit") deposited += assets;
    else withdrawn += assets;
    return {
      type,
      assets: assets.toString(),
      shares: (dataBigInt(e.data, "shares") ?? 0n).toString(),
      txHash: e.txHash,
      at: e.protocolTs !== null ? Number(e.protocolTs) : parseCloseTime(e.data.ledgerClosedAt as string | undefined),
    };
  });

  const value = convertToAssets(shares, stats);
  return {
    address,
    shares: shares.toString(),
    value: value.toString(),
    deposited: deposited.toString(),
    withdrawn: withdrawn.toString(),
    earned: (value + withdrawn - deposited).toString(),
    sharePriceScaled: stats.sharePriceScaled.toString(),
    maxWithdraw: maxWithdraw.toString(),
    history: history.reverse(),
  };
}
