"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { useRef, useState, useSyncExternalStore } from "react";

import type { AgentTxAction } from "@/lib/types/api";

import {
  describeWebAuthnError,
  registerPasskey,
  retryProvisioning,
  signAndSubmitAgentAction,
  signInWithPasskey,
  type AgentActionPhase,
  type PasskeyClientError,
} from "./client";

export type AsyncStatus = "idle" | "pending" | "success" | "error";

export interface PasskeyTask<Args extends unknown[], Result> {
  status: AsyncStatus;
  result: Result | null;
  error: PasskeyClientError | null;
  /** Runs the task; resolves to the result, or null on failure (the error is in `error`). Ignored while pending. */
  run: (...args: Args) => Promise<Result | null>;
  reset: () => void;
}

/** Wraps an async passkey flow with status/result/error state and double-submit protection. */
export function usePasskeyTask<Args extends unknown[], Result>(task: (...args: Args) => Promise<Result>): PasskeyTask<Args, Result> {
  const [state, setState] = useState<{ status: AsyncStatus; result: Result | null; error: PasskeyClientError | null }>({
    status: "idle",
    result: null,
    error: null,
  });
  const running = useRef(false);

  const run = async (...args: Args): Promise<Result | null> => {
    if (running.current) return null;
    running.current = true;
    setState({ status: "pending", result: null, error: null });
    try {
      const result = await task(...args);
      setState({ status: "success", result, error: null });
      return result;
    } catch (err) {
      setState({ status: "error", result: null, error: describeWebAuthnError(err) });
      return null;
    } finally {
      running.current = false;
    }
  };

  const reset = () => setState({ status: "idle", result: null, error: null });
  return { ...state, run, reset };
}

/** Create a passkey (onboarding); agents also get their smart account and card. */
export const usePasskeyRegistration = () => usePasskeyTask(registerPasskey);

/** Discoverable passkey sign-in. */
export const usePasskeySignIn = () => usePasskeyTask(signInWithPasskey);

/** Retry a failed smart account / card step. */
export const useProvisioningRetry = () => usePasskeyTask(retryProvisioning);

/** Sign (passkey prompt) and submit an agent action; `phase` tracks prepare → sign → submit. */
export function useAgentAction() {
  const [phase, setPhase] = useState<AgentActionPhase | null>(null);
  const task = usePasskeyTask((action: AgentTxAction) => signAndSubmitAgentAction(action, setPhase));
  return { ...task, phase: task.status === "pending" ? phase : null };
}

const noopSubscribe = () => () => {};

/** Whether this browser can use passkeys (null while rendering on the server). */
export function usePasskeySupport(): boolean | null {
  return useSyncExternalStore(noopSubscribe, browserSupportsWebAuthn, () => null);
}
