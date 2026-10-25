"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { AgentApi } from "./api";

export interface AgentAppContextValue {
  api: AgentApi;
  /** Reloads the overview now (after an action). */
  refresh: () => Promise<void>;
  /** Preview gallery: fixture data, fake API, passkey actions disabled. */
  preview: boolean;
}

const AgentAppContext = createContext<AgentAppContextValue | null>(null);

export function AgentAppProvider({ value, children }: { value: AgentAppContextValue; children: ReactNode }) {
  return <AgentAppContext.Provider value={value}>{children}</AgentAppContext.Provider>;
}

export function useAgentApp(): AgentAppContextValue {
  const ctx = useContext(AgentAppContext);
  if (!ctx) throw new Error("Agent app components must be rendered inside <AgentAppProvider>");
  return ctx;
}
