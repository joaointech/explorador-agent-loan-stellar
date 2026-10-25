// Stellar addresses and hashes for display (spec §10.1: `CDLZ…4XQA`), plus
// stellar.expert links. Testnet only.

export type AddressKind = "account" | "contract" | "muxed" | "unknown";

/** `CDLZ…4XQA`: first and last characters joined by an ellipsis. Short strings pass through. */
export function truncateAddress(address: string, head = 4, tail = 4): string {
  if (!address) return "";
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** Transaction hashes and other hex: `a1b2c3…7f8e` (6 + 4 by default). */
export function truncateHash(hash: string, head = 6, tail = 4): string {
  return truncateAddress(hash, head, tail);
}

/** G… = account, C… = contract (smart accounts too), M… = muxed account. */
export function addressKind(address: string): AddressKind {
  const first = address.trim().charAt(0).toUpperCase();
  if (first === "G") return "account";
  if (first === "C") return "contract";
  if (first === "M") return "muxed";
  return "unknown";
}

/** Base URL of the block explorer for the network we run on. */
export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

const trimBase = (base: string) => base.replace(/\/+$/, "");

/** stellar.expert page for a transaction hash. */
export function explorerTxUrl(hash: string, base: string = EXPLORER_BASE): string {
  return `${trimBase(base)}/tx/${encodeURIComponent(hash)}`;
}

/** stellar.expert page for a classic account (G…). */
export function explorerAccountUrl(address: string, base: string = EXPLORER_BASE): string {
  return `${trimBase(base)}/account/${encodeURIComponent(address)}`;
}

/** stellar.expert page for a contract (C…), including agent smart accounts. */
export function explorerContractUrl(contractId: string, base: string = EXPLORER_BASE): string {
  return `${trimBase(base)}/contract/${encodeURIComponent(contractId)}`;
}

/** stellar.expert page for a ledger sequence. */
export function explorerLedgerUrl(sequence: number, base: string = EXPLORER_BASE): string {
  return `${trimBase(base)}/ledger/${sequence}`;
}

/** Picks the contract or account page from the address prefix. */
export function explorerAddressUrl(address: string, base: string = EXPLORER_BASE): string {
  return addressKind(address) === "contract" ? explorerContractUrl(address, base) : explorerAccountUrl(address, base);
}
