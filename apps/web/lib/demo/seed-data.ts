// Seed data (spec §11.2): three agents, two investors and five CPCVs with
// realistic Portuguese data. Days are relative to the protocol date when the
// seed starts (D0); the seed fast-forwards 120 protocol days in total, so the
// active notes end with their escrituras 55 and 75 days ahead (30–90 required)
// and the cancelled note is still inside its 180-day grace period.

import type { DealInput } from "./cpcv";

/** Portuguese NIF: 8 digits + mod-11 check digit. */
export function nif(prefix8: string): string {
  if (!/^\d{8}$/.test(prefix8)) throw new Error(`NIF prefix must be 8 digits: ${prefix8}`);
  const sum = [...prefix8].reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const check = 11 - (sum % 11);
  return `${prefix8}${check >= 10 ? 0 : check}`;
}

export type AgentKey = "ana" | "bruno" | "carla";

export const SEED_AGENTS: { key: AgentKey; email: string; displayName: string }[] = [
  { key: "ana", email: "ana@demo.explorador.pt", displayName: "Ana Costa" },
  { key: "bruno", email: "bruno@demo.explorador.pt", displayName: "Bruno Ferreira" },
  { key: "carla", email: "carla@demo.explorador.pt", displayName: "Carla Mendes" },
];

export const SEED_INVESTORS: { label: string; amountEur: number }[] = [
  { label: "1", amountEur: 40_000 },
  { label: "2", amountEur: 25_000 },
];

export type DealKey = "A1" | "B2" | "C3" | "B4" | "A5";

export interface SeedDeal {
  key: DealKey;
  agent: AgentKey;
  /** Protocol day offsets from D0. */
  mintOn: number;
  escrituraOn: number;
  cpcvOn: number;
  deal: Omit<DealInput, "cpcvDay" | "escrituraDay">;
}

export const SEED_DEALS: Record<DealKey, SeedDeal> = {
  // 1. Ana: active, ~70% of the credit used through four card draws.
  A1: {
    key: "A1",
    agent: "ana",
    mintOn: 0,
    escrituraOn: 175,
    cpcvOn: -3,
    deal: {
      buyerName: "Miguel Andrade Sousa",
      buyerNif: nif("21345678"),
      sellerName: "Helena Marques Pires",
      sellerNif: nif("18765432"),
      propertyAddress: "Rua Castilho 39, 3.º Esq., 1250-068 Lisboa",
      salePriceCents: 48_500_000n,
      commissionRateBps: 500,
    },
  },
  // 2. Bruno: active, lightly used.
  B2: {
    key: "B2",
    agent: "bruno",
    mintOn: 90,
    escrituraOn: 195,
    cpcvOn: 87,
    deal: {
      buyerName: "Rui Carvalho Lopes",
      buyerNif: nif("23456781"),
      sellerName: "Teresa Gonçalves Silva",
      sellerNif: nif("16543210"),
      propertyAddress: "Avenida da Liberdade 412, 4710-251 Braga",
      salePriceCents: 39_500_000n,
      commissionRateBps: 500,
    },
  },
  // 3. Carla: settled (debt repaid, junior top-up, card balance).
  C3: {
    key: "C3",
    agent: "carla",
    mintOn: 0,
    escrituraOn: 60,
    cpcvOn: -5,
    deal: {
      buyerName: "Sofia Almeida Rocha",
      buyerNif: nif("24681357"),
      sellerName: "Joaquim Pereira Nunes",
      sellerNif: nif("13579246"),
      propertyAddress: "Rua de Cedofeita 215, 2.º, 4050-180 Porto",
      salePriceCents: 31_200_000n,
      commissionRateBps: 450,
    },
  },
  // 4. Bruno: cancelled (buyer walked away), carried debt in grace.
  B4: {
    key: "B4",
    agent: "bruno",
    mintOn: 60,
    escrituraOn: 150,
    cpcvOn: 57,
    deal: {
      buyerName: "Pedro Martins Correia",
      buyerNif: nif("25813579"),
      sellerName: "Isabel Fernandes Costa",
      sellerNif: nif("14725836"),
      propertyAddress: "Rua de Santo António 58, 8000-283 Faro",
      salePriceCents: 18_500_000n,
      commissionRateBps: 500,
    },
  },
  // 5. Ana: settled earlier, card-balance spends afterwards.
  A5: {
    key: "A5",
    agent: "ana",
    mintOn: 30,
    escrituraOn: 75,
    cpcvOn: 26,
    deal: {
      buyerName: "Catarina Ribeiro Matos",
      buyerNif: nif("22233344"),
      sellerName: "António Vieira Santos",
      sellerNif: nif("17654321"),
      propertyAddress: "Avenida Rei Humberto II de Itália 1520, 2750-800 Cascais",
      salePriceCents: 62_000_000n,
      commissionRateBps: 400,
    },
  },
};

export interface SeedSpend {
  agent: AgentKey;
  amountEur: number;
  merchant: string;
}

/** Card purchases per phase (protocol day offset → spends), in order. */
export const SEED_SPENDS = {
  // Day 0: Ana on A1 (her only line), Carla on C3.
  day0: [
    { agent: "ana", amountEur: 1_240.0, merchant: "TAP Air Portugal" },
    { agent: "ana", amountEur: 1_385.4, merchant: "IKEA Alfragide" },
    { agent: "carla", amountEur: 864.25, merchant: "Leroy Merlin Matosinhos" },
  ],
  // Day 30, before A5 is minted: two more on A1 (4,100.00 drawn ≈ 68% of €6,062.50, ~70% with interest).
  day30a1: [
    { agent: "ana", amountEur: 899.99, merchant: "Worten Colombo" },
    { agent: "ana", amountEur: 574.61, merchant: "El Corte Inglés Lisboa" },
  ],
  // Day 30, after A5 is minted: A5 has the earliest escritura, so these draw on A5.
  day30a5: [
    { agent: "ana", amountEur: 1_149.0, merchant: "Fnac Chiado" },
    { agent: "ana", amountEur: 212.35, merchant: "Continente Cascais" },
    { agent: "carla", amountEur: 48.7, merchant: "Pingo Doce Boavista" },
  ],
  // Day 60: Bruno on B4 (to be cancelled).
  day60: [
    { agent: "bruno", amountEur: 1_099.0, merchant: "Worten Faro" },
    { agent: "bruno", amountEur: 401.0, merchant: "Leroy Merlin Loulé" },
  ],
  // Day 75, after A5 settles: paid from Ana's card balance.
  day75: [
    { agent: "ana", amountEur: 4.8, merchant: "Pastelaria Aloma" },
    { agent: "ana", amountEur: 96.5, merchant: "Cervejaria Ramiro" },
  ],
  // Day 90, after B4 is cancelled and B2 minted: lightly used B2.
  day90: [{ agent: "bruno", amountEur: 385.9, merchant: "IKEA Braga" }],
} satisfies Record<string, SeedSpend[]>;

/** Total protocol days the seed fast-forwards (30 + 30 + 15 + 15 + 30). */
export const SEED_TOTAL_DAYS = 120;
