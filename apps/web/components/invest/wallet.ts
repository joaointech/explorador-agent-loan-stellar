"use client";
import * as React from "react";
import { connectFreighter, forgetFreighter, freighterInstalled, freighterNetwork, restoreFreighter, type FreighterNetwork } from "@/lib/client/freighter";
import { errorMessage } from "@/lib/client/api";

export interface WalletState {
  installed: boolean | null;
  address: string | null;
  network: FreighterNetwork | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  recheck: () => Promise<void>;
}

/** Freighter connection state: restores a previous session silently and re-checks network/account on focus. */
export function useFreighterWallet(): WalletState {
  const [installed, setInstalled] = React.useState<boolean | null>(null);
  const [address, setAddress] = React.useState<string | null>(null);
  const [network, setNetwork] = React.useState<FreighterNetwork | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const recheck = React.useCallback(async () => {
    const ok = await freighterInstalled();
    setInstalled(ok);
    if (!ok) return;
    const a = await restoreFreighter();
    setAddress(a);
    if (a) setNetwork(await freighterNetwork().catch(() => null));
  }, []);

  React.useEffect(() => {
    void recheck();
    const onFocus = () => void recheck();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recheck]);

  const connect = React.useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await connectFreighter();
      setAddress(a);
      setInstalled(true);
      setNetwork(await freighterNetwork().catch(() => null));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = React.useCallback(() => {
    forgetFreighter();
    setAddress(null);
    setNetwork(null);
  }, []);

  return { installed, address, network, connecting, error, connect, disconnect, recheck };
}
