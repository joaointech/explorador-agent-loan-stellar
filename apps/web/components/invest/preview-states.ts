// States of /invest/preview (shared by the server page and the client preview).

export const PREVIEW_STATES = [
  { id: "connected-position", label: "Connected, with position" },
  { id: "connected-empty", label: "Connected, no position" },
  { id: "unfunded", label: "New account (no XLM)" },
  { id: "disconnected", label: "Wallet not connected" },
  { id: "no-wallet", label: "Freighter not installed" },
  { id: "wrong-network", label: "Wrong network" },
  { id: "not-deployed", label: "Pool not deployed" },
  { id: "loading", label: "Loading" },
  { id: "error", label: "API error" },
] as const;

export type PreviewState = (typeof PREVIEW_STATES)[number]["id"];

export const isPreviewState = (s: unknown): s is PreviewState => PREVIEW_STATES.some((p) => p.id === s);
