// Display formatting for the whole UI (spec §10.1). Pure functions, safe on the
// server and the client, deterministic across machines (fixed locale en-GB and
// fixed time zone Europe/Lisbon).
//
//   formatEur("37500000000")          → "€3,750.00"    (stroops: the API default)
//   formatEur(375000, { unit: "cents" }) → "€3,750.00"
//   formatDate(20832)                 → "14 Jan 2027"  (day number, unix secs, ISO or Date)
//   formatDateTime(1799942400)        → "14 Jan 2027, 16:00" (Europe/Lisbon)
//   truncateAddress("CDLZ…")          → "CDLZ…4XQA"
//   formatPercent(0.0648)             → "6.48%"
//   formatBps(1200)                   → "12%"
//   explorerTxUrl(hash)               → stellar.expert testnet link

export * from "./address";
export * from "./date";
export * from "./money";
export * from "./number";
