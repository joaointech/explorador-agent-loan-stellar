// The agent app rendered in every mocked state, server-side (what the first
// paint shows), checking each state's key content.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/components/ui/toast";

import type { AgentOverviewResponse } from "@/lib/types/api";

import { AgentDashboard } from "./agent-dashboard";
import { AgentAppProvider } from "./context";
import { AGENT_FIXTURES, type AgentFixtureName } from "./fixtures";
import { createPreviewApi } from "./preview-api";

function render(fixture: AgentFixtureName | AgentOverviewResponse, opts: { preview?: boolean; error?: string } = {}): string {
  const data = typeof fixture === "string" ? AGENT_FIXTURES[fixture] : fixture;
  const html = renderToStaticMarkup(
    <ToastProvider>
      <AgentAppProvider value={{ api: createPreviewApi(() => data), refresh: async () => {}, preview: opts.preview ?? false }}>
        <AgentDashboard data={data} status={{ error: opts.error ?? null, refreshing: false }} />
      </AgentAppProvider>
    </ToastProvider>,
  );
  // Plain text, whitespace collapsed, so assertions read like the page.
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("agent app states (server render)", () => {
  it("new agent: passkey step, card placeholder, no balances", () => {
    const text = render("newAgent");
    expect(text).toContain("Set up your card in a minute");
    expect(text).toContain("Create your passkey");
    expect(text).toContain("Create passkey →");
    expect(text).toContain("Your virtual card");
    expect(text).toContain("Hello ");
    expect(text).not.toContain("Available to spend");
    expect(text).not.toContain("Deals");
  });

  it("provisioning failed: retry with the setup checklist", () => {
    const text = render("provisioningFailed");
    expect(text).toContain("Finishing your account");
    expect(text).toContain("Passkey saved , done");
    expect(text).toContain("Smart account on Stellar , not done yet");
    expect(text).toContain("Try again");
  });

  it("card created: activation step, inactive card, empty deals", () => {
    const text = render("awaitingActivation");
    expect(text).toContain("One last step");
    expect(text).toContain("Activate your card");
    expect(text).toContain("One passkey prompt records your on-chain consent");
    expect(text).toContain("Not active yet");
    expect(text).toContain("Available to spend");
    expect(text).toContain("Activate your card to start spending.");
    expect(text).toContain("No deals yet");
  });

  it("seed agent: passkey skipped, activation without a prompt, overdue deal", () => {
    const text = render("seedAgent");
    expect(text).toContain("Passkey (skipped)");
    expect(text).toContain("signed by a server-held demo key, so activation needs no passkey prompt");
    expect(text).toContain("Overdue");
    expect(text).toContain("Overdue by 2 days");
    expect(text).toContain("Seed account: sign in with the email code.");
  });

  it("active without deals", () => {
    const text = render("activeNoDeals");
    expect(text).not.toContain("Get started");
    expect(text).toContain("No deals yet");
    expect(text).toContain("No activity yet");
    expect(text).toContain("Opens when explorador mints your first CPCV Note.");
    expect(text).toContain("Simulate purchase");
  });

  it("active with deals: card, spendable, live debt, deals and activity", () => {
    const text = render("activeWithDeals");
    expect(text).toContain("Hello, Inês");
    expect(text).toContain("Live");
    expect(text).toContain("•••• •••• •••• 4242");
    expect(text).toContain("Virtual · Simulated");
    expect(text).toContain("Reveal details");
    expect(text).toContain("€3,869 .25"); // €406.43 + €3,524.82 − €62.00 held (cents rendered smaller)
    expect(text).toContain("€62.00 approved, recording on Stellar");
    expect(text).toContain("Card balance Paid out by settled deals. Spent first. €406.43");
    expect(text).toContain("Credit available 50% of your commission on active deals, minus debt. €3,524.82");
    expect(text).toContain("€2,600.00 principal + €25.180000 interest · 12% APR");
    expect(text).toContain("Deal #12");
    expect(text).toContain("Your commission €7,500.00");
    expect(text).toContain("Credit limit €3,750.00");
    expect(text).toContain("Used €2,625.18");
    expect(text).toContain("9 Dec 2026");
    expect(text).toContain("45 days left");
    expect(text).toContain("Escritura done: €4,411.23 added to your card balance.");
    expect(text).toContain("Deal #9 settled: €4,411.23 added to your card balance");
    expect(text).toContain("from balance €4.80 / on credit €0.00");
    expect(text).toContain("Recording on Stellar");
    expect(text).toContain("Declined · Insufficient funds");
    expect(text).toContain("Withdrawn to your account");
    expect(text).toContain("Show all 10");
    expect(text).toContain("Withdraw balance to my account");
    expect(text).toContain("Pause card");
    expect(text).toContain("Signs card actions");
  });

  it("carried debt: banner with amount and grace countdown", () => {
    const text = render("carriedDebt");
    expect(text).toContain("Carried debt €2,034.11");
    expect(text).toContain("keeps accruing 12% APR");
    expect(text).toContain("Grace period ends 18 Apr 2027 · 175 days left");
    expect(text).toContain("written off against explorador's first-loss capital");
    expect(text).toContain("Deal #14 cancelled: €2,000.00 moved to carried debt");
    expect(text).toContain("The buyer withdrew: €2,000.00 of debt moved to your carried debt.");
    expect(text).toContain("Cancelled");
  });

  it("written off: blocked banner", () => {
    const text = render("writtenOff");
    expect(text).toContain("New credit is blocked");
    expect(text).toContain("Written off");
    expect(text).not.toContain("Grace period ends");
    expect(text).toContain("Credit available Blocked after a write-off: no new credit.");
    expect(text).not.toContain("your first CPCV Note");
  });

  it("past deals only (all settled or cancelled): credit opens with the next note, not the first", () => {
    const base = AGENT_FIXTURES.activeWithDeals;
    const text = render({ ...base, position: { ...base.position!, lines: [] }, deals: base.deals.filter((d) => d.status === "SETTLED") });
    expect(text).toContain("Credit available Opens again when explorador mints your next CPCV Note.");
    expect(text).not.toContain("your first CPCV Note");
  });

  it("paused card: resume banner, purchases disabled", () => {
    const text = render("pausedCard");
    expect(text).toContain("Your card is paused");
    expect(text).toContain("Resume card");
    expect(text).toContain("Your card is paused. Resume it in Settings.");
  });

  it("offline: last known balances", () => {
    const text = render("offline");
    expect(text).toContain("Last known");
    expect(text).toContain("Showing your last known balances");
    expect(text).toContain("these are from 11:58");
  });

  it("no position at all (Stellar unreachable, nothing cached): unknowns, not zeros", () => {
    const text = render({ ...AGENT_FIXTURES.activeWithDeals, position: null, positionSource: "none", pendingHolds: "0" });
    expect(text).toContain("Connecting");
    expect(text).toContain("Waiting for Stellar");
    expect(text).toContain("Used —");
    expect(text).toContain("Your balances are loading from Stellar.");
    expect(text).not.toContain("Credit used");
  });

  it("a failed refresh keeps the data and says so", () => {
    expect(render("activeWithDeals", { error: "Network error" })).toContain("Can't refresh");
  });

  it("renders the same in the preview gallery (inert passkey actions)", () => {
    expect(render("awaitingActivation", { preview: true })).toContain("Activate card");
  });
});
