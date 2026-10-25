"use client";

// Ready-to-use passkey buttons for the agent app and sign-in pages. Styling
// follows spec §10.1 (primary blue-600, rounded-xl, h-11); pass `className` to
// restyle. Every button shows its progress and errors below itself.

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type {
  AgentProvisioning,
  AgentTxAction,
  AgentTxSubmitResponse,
  PasskeyLoginVerifyResponse,
  PasskeyRegisterVerifyResponse,
} from "@/lib/types/api";

import type { AgentActionPhase, PasskeyClientError } from "./client";
import { useAgentAction, usePasskeyRegistration, usePasskeySignIn, usePasskeySupport, useProvisioningRetry } from "./hooks";

export const passkeyButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white " +
  "transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 " +
  "disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600";

interface ButtonProps {
  className?: string;
  children?: ReactNode;
}

function Feedback({ error, notice, success }: { error?: PasskeyClientError | null; notice?: string | null; success?: ReactNode }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error.message}
      </p>
    );
  }
  if (notice) {
    return (
      <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
        {notice}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
        {success}
      </p>
    );
  }
  return null;
}

function provisioningNotice(p: AgentProvisioning | null | undefined): string | null {
  if (!p || p.status === "complete") return null;
  const what = p.failedStep === "card" ? "your card" : "your account";
  return `Your passkey is saved, but ${what} isn't ready yet (${p.error ?? "unknown error"}). Try again in a moment.`;
}

/** Onboarding: creates the passkey. For agents the server also deploys the smart account and creates the card. */
export function RegisterPasskeyButton({
  className,
  children,
  onRegistered,
}: ButtonProps & { onRegistered?: (result: PasskeyRegisterVerifyResponse) => void }) {
  const supported = usePasskeySupport();
  const { status, error, result, run } = usePasskeyRegistration();
  const pending = status === "pending";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className ?? passkeyButtonClass}
        disabled={pending || supported === false}
        aria-busy={pending}
        onClick={async () => {
          const res = await run();
          if (res) onRegistered?.(res);
        }}
      >
        {pending ? "Setting up your account…" : (children ?? "Create passkey →")}
      </button>
      <Feedback
        error={error}
        notice={supported === false ? "This browser doesn't support passkeys." : provisioningNotice(result?.provisioning)}
      />
    </div>
  );
}

/** Retries a failed smart account / card step after registration. */
export function RetryProvisioningButton({
  className,
  children,
  onProvisioned,
}: ButtonProps & { onProvisioned?: (result: AgentProvisioning) => void }) {
  const { status, error, result, run } = useProvisioningRetry();
  const pending = status === "pending";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className ?? passkeyButtonClass}
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          const res = await run();
          if (res) onProvisioned?.(res);
        }}
      >
        {pending ? "Setting up your account…" : (children ?? "Try again")}
      </button>
      <Feedback error={error} notice={provisioningNotice(result)} />
    </div>
  );
}

/** Discoverable passkey sign-in; navigates to /agent or /admin unless `redirect` is false. */
export function PasskeySignInButton({
  className,
  children,
  redirect = true,
  onSignedIn,
}: ButtonProps & { redirect?: boolean; onSignedIn?: (result: PasskeyLoginVerifyResponse) => void }) {
  const router = useRouter();
  const supported = usePasskeySupport();
  const { status, error, run } = usePasskeySignIn();
  const pending = status === "pending";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className ?? passkeyButtonClass}
        disabled={pending || supported === false}
        aria-busy={pending}
        onClick={async () => {
          const res = await run();
          if (!res) return;
          onSignedIn?.(res);
          if (redirect) {
            router.push(res.redirectTo);
            router.refresh();
          }
        }}
      >
        {pending ? "Waiting for your passkey…" : (children ?? "Sign in with passkey →")}
      </button>
      <Feedback error={error} notice={supported === false ? "This browser doesn't support passkeys: use the email code." : null} />
    </div>
  );
}

const ACTION_LABELS: Record<AgentTxAction["action"], string> = {
  enable_card: "Activate card",
  disable_card: "Pause card",
  withdraw_balance: "Withdraw balance to my account",
};

const PHASE_LABELS: Record<AgentActionPhase, string> = {
  preparing: "Preparing…",
  signing: "Confirm with your passkey…",
  submitting: "Confirming on Stellar…",
};

/** Signs an agent action with the passkey (one prompt) and submits it; the sponsor pays the fee. */
export function AgentActionButton({
  action,
  className,
  children,
  onDone,
}: ButtonProps & { action: AgentTxAction; onDone?: (result: AgentTxSubmitResponse) => void }) {
  const { status, phase, error, result, run } = useAgentAction();
  const pending = status === "pending";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={className ?? passkeyButtonClass}
        disabled={pending}
        aria-busy={pending}
        onClick={async () => {
          const res = await run(action);
          if (res) onDone?.(res);
        }}
      >
        {pending ? PHASE_LABELS[phase ?? "preparing"] : (children ?? ACTION_LABELS[action.action])}
      </button>
      <Feedback
        error={error}
        success={
          result ? (
            <>
              Confirmed on Stellar.{" "}
              <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
                View transaction
              </a>
            </>
          ) : null
        }
      />
    </div>
  );
}
