// Lithic sandbox (§9.4). Card amounts are treated as EUR cents 1:1.
import Lithic from "lithic";
import { env } from "@/lib/env";

/** Visa test BIN card program in the Lithic sandbox. */
export const SANDBOX_CARD_PROGRAM = "00000000-0000-0000-1000-000000000000";

let client: Lithic | null = null;

export function lithicEnabled(): boolean {
  return Boolean(env.lithicApiKey);
}

export function lithic(): Lithic {
  if (!env.lithicApiKey) throw new Error("LITHIC_API_KEY is not set");
  client ??= new Lithic({ apiKey: env.lithicApiKey, environment: "sandbox" });
  return client;
}

export async function createCard(agentUserId: string): Promise<{ token: string; last4: string }> {
  const l = lithic();
  let card;
  try {
    card = await l.cards.create({ type: "VIRTUAL", memo: agentUserId, card_program_token: SANDBOX_CARD_PROGRAM });
  } catch (e) {
    // Some sandbox accounts don't have the shared test program; fall back to the default program.
    console.warn("Lithic card create with test program failed, retrying with the default program", e);
    card = await l.cards.create({ type: "VIRTUAL", memo: agentUserId });
  }
  return { token: card.token, last4: card.last_four };
}

export async function revealCard(token: string) {
  const card = await lithic().cards.retrieve(token);
  return {
    pan: card.pan ?? "",
    cvv: card.cvv ?? "",
    expMonth: card.exp_month ?? "",
    expYear: card.exp_year ?? "",
  };
}

export async function simulateAuthorization(token: string, amountCents: number, descriptor: string) {
  const l = lithic();
  const card = await l.cards.retrieve(token);
  if (!card.pan) throw new Error("Lithic sandbox did not return a PAN for this card");
  return l.transactions.simulateAuthorization({ amount: amountCents, descriptor, pan: card.pan });
}
