"use client";

import { useMemo, useState } from "react";

import { cn } from "@/components/ui/cn";
import { Eyebrow } from "@/components/ui/typography";

import { AgentDashboard } from "./agent-dashboard";
import { AgentAppProvider } from "./context";
import { AGENT_FIXTURE_LABELS, AGENT_FIXTURES, type AgentFixtureName } from "./fixtures";
import { createPreviewApi } from "./preview-api";

// When this module loaded in the browser: stands in for each fixture's
// fetchedAtMs, so interest and countdowns tick from page load.
const LOADED_AT_MS = Date.now();

const NAMES = Object.keys(AGENT_FIXTURES) as AgentFixtureName[];

/** Every state of the agent app with mocked data (onboarding steps, active, carried debt, …). */
export function AgentPreviewGallery({ initial = "activeWithDeals" }: { initial?: AgentFixtureName }) {
  const [name, setName] = useState<AgentFixtureName>(initial);
  const data = useMemo(() => {
    const fixture = AGENT_FIXTURES[name];
    return { ...fixture, rates: { ...fixture.rates, fetchedAtMs: LOADED_AT_MS } };
  }, [name]);
  const api = useMemo(() => createPreviewApi(() => data), [data]);

  return (
    <>
      <div className="border-b border-line bg-card">
        <div className="mx-auto w-full max-w-7xl px-4 py-3">
          <Eyebrow tone="primary">Preview · mocked data</Eyebrow>
          <nav aria-label="Agent app states" className="no-scrollbar -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
            {NAMES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === name}
                onClick={() => setName(n)}
                className={cn(
                  "h-8 shrink-0 rounded-full px-3 text-xs font-semibold ring-1 transition-colors",
                  n === name ? "bg-primary text-white ring-primary" : "bg-card text-muted ring-line hover:text-primary-text",
                )}
              >
                {AGENT_FIXTURE_LABELS[n]}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <AgentAppProvider value={{ api, refresh: async () => {}, preview: true }}>
        <AgentDashboard key={name} data={data} status={{ error: null, refreshing: false }} />
      </AgentAppProvider>
    </>
  );
}
