import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { STROOPS_PER_EUR } from "@/lib/units";

import { FIXTURE_SHARE_PRICE_SCALED, fixtureEmptyInvestor, fixtureInvestor, fixtureLive, fixtureStats } from "./fixtures";
import { previewActions, previewModel } from "./invest-preview";
import { InvestView } from "./invest-view";
import { derivePosition, stroopsToEurInput } from "./model";
import { PREVIEW_STATES, type PreviewState } from "./preview-states";

const actions = previewActions(
  () => {},
  () => {},
);

/** Server-rendered text of the dashboard in a preview state (tags stripped). */
function render(state: PreviewState): string {
  const html = renderToStaticMarkup(
    <ToastProvider>
      <InvestView model={previewModel(state)} actions={actions} />
    </ToastProvider>,
  );
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("InvestView renders every state with mocked data", () => {
  it.each(PREVIEW_STATES.map((s) => s.id))("%s", (state) => {
    const text = render(state);
    // Always: the hero and the yield explainer with the §5.6 illustration.
    expect(text).toContain("Earn from agents' advances.");
    expect(text).toContain("How your yield works");
    expect(text).toContain("€6,480");
    expect(text).toContain("17.2%");
  });

  it("no wallet: offers to install Freighter", () => {
    const text = render("no-wallet");
    expect(text).toContain("Freighter isn't installed");
    expect(text).toContain("Install Freighter");
  });

  it("disconnected: Connect Freighter, the steps to start, and the gated vault panel", () => {
    const text = render("disconnected");
    expect(text).toContain("Connect Freighter");
    expect(text).toContain("Get test funds");
    expect(text).toContain("Live from the pool contract");
  });

  it("wrong network: asks to switch Freighter to Testnet", () => {
    const text = render("wrong-network");
    expect(text).toContain("Switch Freighter to Testnet");
    expect(text).toContain("Freighter is on Mainnet");
  });

  it("not deployed: explains it and hides pool health", () => {
    const text = render("not-deployed");
    expect(text).toContain("The pool isn't deployed yet");
    expect(text).toContain("Pool not deployed yet");
    expect(text).not.toContain("Live from the pool contract");
  });

  it("error: offers a retry", () => {
    const text = render("error");
    expect(text).toContain("Can't load the pool right now");
    expect(text).toContain("Try again");
  });

  it("connected without a position: empty state, balances and helpers", () => {
    const text = render("connected-empty");
    expect(text).toContain("No position yet");
    expect(text).toContain("10,000.00");
    expect(text).toContain("Get 10,000 tEURC");
  });

  it("new account: highlights test XLM and gates the deposit", () => {
    const text = render("unfunded");
    expect(text).toContain("Not funded yet");
    expect(text).toContain("Get test XLM first");
  });

  it("connected with a position: value, shares, history and pool health", () => {
    const text = render("connected-position");
    expect(text).toContain("Current value");
    expect(text).toContain("4,987.1234 eaSR");
    expect(text).toContain("Your activity");
    expect(text).toContain("Available liquidity now");
    expect(text).toContain("Notes by status");
    expect(text).toContain("0.56×");
    expect(text).toContain("Share price and pool size");
  });
});

describe("derivePosition", () => {
  const EUR = STROOPS_PER_EUR;

  it("prefers live reads and recomputes earned from the live value", () => {
    const live = { ...fixtureLive(), value: 5_100n * EUR };
    const p = derivePosition({ investor: fixtureInvestor(), live, stats: fixtureStats() });
    expect(p.value).toBe(5_100n * EUR);
    expect(p.earned).toBe(100n * EUR); // 5,100 + 1,000 withdrawn − 6,000 deposited
    expect(p.sharePriceScaled).toBe(FIXTURE_SHARE_PRICE_SCALED);
    expect(p.hasShares).toBe(true);
    expect(p.isEmpty).toBe(false);
  });

  it("falls back to the API, and knows an unfunded account from an unknown one", () => {
    const api = derivePosition({ investor: fixtureInvestor() });
    expect(api.shares).toBe(BigInt(fixtureInvestor().shares));
    expect(api.xlm).toBeUndefined();
    expect(derivePosition({ live: fixtureLive({ unfunded: true }) }).xlm).toBeNull();
  });

  it("is empty before the first deposit", () => {
    expect(derivePosition({ live: fixtureLive({ empty: true }) }).isEmpty).toBe(true);
  });

  describe("a deposit confirmed before the indexer reports it", () => {
    const flow = { type: "deposit" as const, assets: 5_000n * EUR, shares: 4_960n * EUR, txHash: "f".repeat(64), confirmedAt: 1_000 };
    const before = fixtureEmptyInvestor();

    it("doesn't count as earnings once the live read includes it", () => {
      const live = { ...fixtureLive({ empty: true }), shares: flow.shares, value: 5_000n * EUR };
      const p = derivePosition({ investor: before, live, liveUpdatedAt: 2_000, pendingFlows: [flow] });
      expect(p.deposited).toBe(5_000n * EUR);
      expect(p.earned).toBe(0n);
      expect(p.history[0]).toMatchObject({ type: "deposit", txHash: flow.txHash });
      expect(p.isEmpty).toBe(false);
    });

    it("isn't added while the live read still predates it", () => {
      const p = derivePosition({ investor: before, live: fixtureLive({ empty: true }), liveUpdatedAt: 500, pendingFlows: [flow] });
      expect(p.deposited).toBe(0n);
      expect(p.earned).toBe(0n);
    });

    it("is dropped once the API history contains it", () => {
      const indexed = { ...before, deposited: String(5_000n * EUR), history: [{ type: "deposit" as const, assets: String(flow.assets), shares: String(flow.shares), txHash: flow.txHash, at: 1 }] };
      const live = { ...fixtureLive({ empty: true }), shares: flow.shares, value: 5_000n * EUR };
      const p = derivePosition({ investor: indexed, live, liveUpdatedAt: 2_000, pendingFlows: [flow] });
      expect(p.deposited).toBe(5_000n * EUR);
      expect(p.history).toHaveLength(1);
    });
  });
});

describe("stroopsToEurInput", () => {
  it("floors to whole cents so Max never exceeds the balance", () => {
    expect(stroopsToEurInput(12_345_678_901n)).toBe("1234.56");
    expect(stroopsToEurInput(100_000_000_000n)).toBe("10000.00");
    expect(stroopsToEurInput(99_999n)).toBe("0.00");
    expect(stroopsToEurInput(0n)).toBe("0.00");
  });
});
