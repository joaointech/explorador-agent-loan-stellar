// "Fill with demo data" for the New CPCV form: realistic Portuguese deals
// (spec §11.2: Lisboa, Porto, Braga, Cascais, Faro; €185k–€620k; 4–5%), with
// fresh valid NIFs each time so the same demo deal is never financed twice.

const BUYERS = ["Maria Silva", "Tiago Rodrigues", "Inês Almeida", "Duarte Sousa", "Beatriz Lopes", "Rafael Gomes"];
const SELLERS = ["João Pereira", "Catarina Martins", "Miguel Oliveira", "Sofia Carvalho", "Pedro Santos", "Leonor Ribeiro"];
const PROPERTIES = [
  { address: "Rua Augusta 100, 3.º Esq., 1100-053 Lisboa", priceEur: 300_000, ratePct: "5" },
  { address: "Rua de Santa Catarina 215, 4000-447 Porto", priceEur: 415_000, ratePct: "4.5" },
  { address: "Avenida da Liberdade 48, 4710-251 Braga", priceEur: 185_000, ratePct: "5" },
  { address: "Avenida Marginal 7120, 2750-427 Cascais", priceEur: 620_000, ratePct: "4" },
  { address: "Rua de Santo António 52, 8000-283 Faro", priceEur: 248_000, ratePct: "4.75" },
];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A random valid Portuguese personal NIF (first digit 1–3, mod-11 check digit). */
export function randomNif(): string {
  const digits = [1 + Math.floor(Math.random() * 3), ...Array.from({ length: 7 }, () => Math.floor(Math.random() * 10))];
  const sum = digits.reduce((acc, d, i) => acc + d * (9 - i), 0);
  const rest = sum % 11;
  return [...digits, rest < 2 ? 0 : 11 - rest].join("");
}

export interface DemoDeal {
  buyerName: string;
  buyerNif: string;
  sellerName: string;
  sellerNif: string;
  propertyAddress: string;
  /** Raw euros for the sale price input. */
  salePrice: string;
  /** Raw percentage for the commission rate input. */
  ratePct: string;
}

/** The n-th demo deal: the spec's worked example first (€300,000 at 5%, Lisboa), then the other cities in turn. */
export function demoDeal(n: number): DemoDeal {
  const property = PROPERTIES[n % PROPERTIES.length];
  const buyerNif = randomNif();
  let sellerNif = randomNif();
  while (sellerNif === buyerNif) sellerNif = randomNif();
  return {
    buyerName: pick(BUYERS),
    buyerNif,
    sellerName: pick(SELLERS),
    sellerNif,
    propertyAddress: property.address,
    salePrice: String(property.priceEur),
    ratePct: property.ratePct,
  };
}
