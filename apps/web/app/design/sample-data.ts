// Static sample data for the /design showcase. Amounts follow the API
// contract: decimal strings of stroops. Numbers echo the spec §5.6 worked example.

import type { RegistryNote } from "@/lib/types/api";

/** Protocol "now" used across the showcase: 14 Jan 2027, 16:00 UTC. */
export const SAMPLE_NOW = Date.UTC(2027, 0, 14, 16, 0) / 1000;
export const SAMPLE_DAY = Math.floor(SAMPLE_NOW / 86_400);

export const SAMPLE_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHG4XQA";
export const SAMPLE_ACCOUNT = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
export const SAMPLE_TX = "7b1e5f0a9c3d4e2f8a6b0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f7";

export const SAMPLE_NOTES: RegistryNote[] = [
  {
    id: 1,
    agent: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMA4OK",
    totalCommission: "150000000000",
    agentCommission: "75000000000",
    exploradorCommission: "75000000000",
    creditLimit: "37500000000",
    escrituraDay: SAMPLE_DAY + 45,
    status: "Active",
    overdue: false,
    mintedAt: SAMPLE_NOW - 30 * 86_400,
    mintTxHash: SAMPLE_TX,
  },
  {
    id: 2,
    agent: "CC7RTXQJ4UZ2K6WQ3PMNVH5DLA2F6GYB7ZRK4XS3EOTUVW2NIQ7KD3MA",
    totalCommission: "92500000000",
    agentCommission: "46250000000",
    exploradorCommission: "46250000000",
    creditLimit: "23125000000",
    escrituraDay: SAMPLE_DAY - 3,
    status: "Active",
    overdue: true,
    mintedAt: SAMPLE_NOW - 75 * 86_400,
    mintTxHash: "0f9e8d7c6b5a49382716f5e4d3c2b1a0918273645f6e5d4c3b2a19087f6e5d4c",
  },
  {
    id: 3,
    agent: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHG4XQA",
    totalCommission: "310000000000",
    agentCommission: "155000000000",
    exploradorCommission: "155000000000",
    creditLimit: "77500000000",
    escrituraDay: SAMPLE_DAY - 20,
    status: "Settled",
    overdue: false,
    mintedAt: SAMPLE_NOW - 110 * 86_400,
    mintTxHash: "a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3",
  },
  {
    id: 4,
    agent: "CC7RTXQJ4UZ2K6WQ3PMNVH5DLA2F6GYB7ZRK4XS3EOTUVW2NIQ7KD3MA",
    totalCommission: "74000000000",
    agentCommission: "37000000000",
    exploradorCommission: "37000000000",
    creditLimit: "18500000000",
    escrituraDay: SAMPLE_DAY + 12,
    status: "Cancelled",
    overdue: false,
    mintedAt: SAMPLE_NOW - 60 * 86_400,
    mintTxHash: "5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  },
  {
    id: 5,
    agent: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMA4OK",
    totalCommission: "186000000000",
    agentCommission: "93000000000",
    exploradorCommission: "93000000000",
    creditLimit: "46500000000",
    escrituraDay: SAMPLE_DAY - 200,
    status: "WrittenOff",
    overdue: false,
    mintedAt: SAMPLE_NOW - 260 * 86_400,
    mintTxHash: null,
  },
];

/** 30 days of share price (assets per share) drifting up with accrued interest. */
export const SHARE_PRICE_SERIES = Array.from({ length: 30 }, (_, i) => {
  const t = SAMPLE_NOW - (29 - i) * 86_400;
  // ~6.5% APY with a small weekly wobble from settlement timing.
  const price = 1.0412 * Math.pow(1 + 0.0648 / 365, i) + Math.sin(i / 2.3) * 0.00025;
  return { t, price: Number(price.toFixed(5)) };
});

/** 30 days of pool TVL vs outstanding debt, in euros (convert stroops with stroopsToEur). */
export const TVL_DEBT_SERIES = Array.from({ length: 30 }, (_, i) => {
  const t = SAMPLE_NOW - (29 - i) * 86_400;
  const tvl = 75_000 + i * 180 + (i > 18 ? 9_000 : 0);
  const debt = 21_000 + i * 410 + Math.round(Math.sin(i / 3) * 900) - (i > 24 ? 3_088.77 : 0);
  return { t, tvl: Math.round(tvl * 100) / 100, debt: Math.round(debt * 100) / 100 };
});
