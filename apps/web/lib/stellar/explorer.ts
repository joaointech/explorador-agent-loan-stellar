// Client-safe stellar.expert links (spec §9.3). Import from here in client
// components: lib/stellar/contracts.ts re-exports it but also pulls in the
// server-only RPC/database modules.

export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

/** https://stellar.expert/explorer/testnet/{tx|contract|account}/{id} */
export function explorerUrl(kind: "tx" | "contract" | "account", id: string): string {
  return `${EXPLORER_BASE}/${kind}/${id}`;
}
