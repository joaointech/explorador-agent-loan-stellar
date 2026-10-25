"use client";

import { useSyncExternalStore } from "react";

import { toWalletError } from "./errors";
import {
  connectFreighter,
  detectFreighter,
  restoreFreighterSession,
  watchFreighter,
  type FreighterNetwork,
  type FreighterSession,
} from "./freighter";

// Freighter connection state for the investor dashboard (spec §4.1 step 1),
// as one external store per page (useSyncExternalStore):
//
//   checking → unavailable                (extension not installed)
//            → disconnected → connecting → connected (address + network)
//
// While connected and subscribed, the store follows account / network
// switches made in Freighter. An explicit "Disconnect" is remembered in
// localStorage (Freighter has no programmatic disconnect), so a reload
// doesn't silently reconnect.

export type FreighterStatus = "checking" | "unavailable" | "disconnected" | "connecting" | "connected";

export interface FreighterState {
  status: FreighterStatus;
  address: string | null;
  network: FreighterNetwork | null;
  /** Last connection error, shown next to the Connect button. */
  error: string | null;
}

export interface FreighterDeps {
  detect: () => Promise<boolean>;
  restore: () => Promise<FreighterSession | null>;
  connect: () => Promise<FreighterSession>;
  watch: (onChange: (session: FreighterSession | null) => void) => () => void;
  readPreference: () => string | null;
  writePreference: (value: "connected" | "disconnected") => void;
}

export interface FreighterStore {
  getState: () => FreighterState;
  subscribe: (listener: () => void) => () => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Detect again (e.g. after installing the extension). */
  recheck: () => Promise<void>;
}

const PREFERENCE_KEY = "explorador-advance:freighter";

const idle = (status: FreighterStatus, error: string | null = null): FreighterState => ({ status, address: null, network: null, error });
const connectedState = (s: FreighterSession): FreighterState => ({ status: "connected", address: s.address, network: s.network, error: null });

export const SERVER_FREIGHTER_STATE: FreighterState = idle("checking");

export function createFreighterStore(deps: FreighterDeps): FreighterStore {
  let state: FreighterState = SERVER_FREIGHTER_STATE;
  const listeners = new Set<() => void>();
  let stopWatching: (() => void) | null = null;
  /** Bumped by every connect / disconnect / recheck, so a slower earlier call can't overwrite a newer outcome. */
  let generation = 0;

  const syncWatcher = () => {
    const shouldWatch = state.status === "connected" && listeners.size > 0;
    if (shouldWatch && !stopWatching) {
      stopWatching = deps.watch((session) => {
        if (state.status !== "connected") return;
        if (!session) return set(idle("disconnected"));
        if (session.address === state.address && session.network.passphrase === state.network?.passphrase) return;
        set(connectedState(session));
      });
    } else if (!shouldWatch && stopWatching) {
      stopWatching();
      stopWatching = null;
    }
  };

  function set(next: FreighterState) {
    state = next;
    syncWatcher();
    for (const listener of listeners) listener();
  }

  const recheck = async () => {
    const run = ++generation;
    const apply = (next: FreighterState) => {
      if (run === generation) set(next);
    };
    if (!(await deps.detect())) return apply(idle("unavailable"));
    if (deps.readPreference() === "disconnected") return apply(idle("disconnected"));
    try {
      const session = await deps.restore();
      apply(session ? connectedState(session) : idle("disconnected"));
    } catch (err) {
      apply(idle("disconnected", toWalletError(err).message));
    }
  };

  const connect = async () => {
    const run = ++generation;
    const apply = (next: FreighterState) => {
      if (run === generation) set(next);
    };
    set({ ...state, status: "connecting", error: null });
    try {
      if (!(await deps.detect())) return apply(idle("unavailable"));
      const session = await deps.connect();
      // A disconnect (or another connect) since then wins, including the remembered preference.
      if (run !== generation) return;
      deps.writePreference("connected");
      set(connectedState(session));
    } catch (err) {
      apply(idle("disconnected", toWalletError(err).message));
    }
  };

  const disconnect = () => {
    generation += 1;
    deps.writePreference("disconnected");
    set(idle("disconnected"));
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      // First subscriber on this page: find out where Freighter stands.
      if (state.status === "checking") void recheck();
      syncWatcher();
    }
    return () => {
      listeners.delete(listener);
      syncWatcher();
    };
  };

  return { getState: () => state, subscribe, connect, disconnect, recheck };
}

const browserDeps: FreighterDeps = {
  detect: detectFreighter,
  restore: restoreFreighterSession,
  connect: connectFreighter,
  watch: (onChange) => watchFreighter(onChange),
  readPreference: () => {
    try {
      return window.localStorage.getItem(PREFERENCE_KEY);
    } catch {
      return null;
    }
  },
  writePreference: (value) => {
    try {
      window.localStorage.setItem(PREFERENCE_KEY, value);
    } catch {
      // Private mode or blocked storage: the preference just isn't remembered.
    }
  },
};

let store: FreighterStore | null = null;
const getStore = () => (store ??= createFreighterStore(browserDeps));

export interface FreighterController extends FreighterState {
  connect: () => Promise<void>;
  disconnect: () => void;
  recheck: () => Promise<void>;
}

const subscribe = (listener: () => void) => getStore().subscribe(listener);
const getSnapshot = () => getStore().getState();
const getServerSnapshot = () => SERVER_FREIGHTER_STATE;

/** Freighter connection state and actions (one shared store per page). */
export function useFreighter(): FreighterController {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...state,
    connect: () => getStore().connect(),
    disconnect: () => getStore().disconnect(),
    recheck: () => getStore().recheck(),
  };
}
