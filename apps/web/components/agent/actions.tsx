"use client";

// Passkey-signed actions for the agent app, wrapping the shared passkey buttons
// with the design system's button styles, a toast on success and an overview
// refresh. In the preview gallery they render inert lookalikes.

import type { ReactNode } from "react";

import { AgentActionButton, RegisterPasskeyButton, RetryProvisioningButton } from "@/components/passkey";
import { buttonClasses, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import type { AgentProvisioning, AgentTxAction, AgentTxSubmitResponse } from "@/lib/types/api";

import { useAgentApp } from "./context";

interface ActionStyle {
  variant?: ButtonVariant;
  icon?: ReactNode;
  children: ReactNode;
}

/** Full-width action buttons; long labels wrap instead of overflowing on narrow phones. */
const actionClass = (variant: ButtonVariant) =>
  buttonClasses({ variant, fullWidth: true, className: cn("h-auto min-h-11 px-4 py-2 text-center leading-tight whitespace-normal", variant !== "primary" && "text-sm") });

function PreviewOnlyButton({ variant = "primary", icon, children }: ActionStyle) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={actionClass(variant)}
      onClick={() => toast.info("Preview only", { description: "Passkey actions are disabled in the preview gallery." })}
    >
      {icon}
      {children}
    </button>
  );
}

const SUCCESS: Record<AgentTxAction["action"], string> = {
  enable_card: "Card activated",
  disable_card: "Card paused",
  withdraw_balance: "Balance withdrawn to your account",
};

/** enable_card / disable_card / withdraw_balance: one passkey prompt (none for seed agents), sponsor pays the fee. */
export function AgentAction({ action, variant = "primary", icon, children, onDone }: ActionStyle & { action: AgentTxAction; onDone?: (res: AgentTxSubmitResponse) => void }) {
  const { preview, refresh } = useAgentApp();
  const toast = useToast();
  if (preview) return <PreviewOnlyButton variant={variant} icon={icon}>{children}</PreviewOnlyButton>;
  return (
    <AgentActionButton
      action={action}
      className={actionClass(variant)}
      onDone={(res) => {
        toast.success(SUCCESS[res.action], { action: { label: "View transaction", href: res.explorerUrl } });
        onDone?.(res);
        void refresh();
      }}
    >
      {icon}
      {children}
    </AgentActionButton>
  );
}

function provisioningToast(toast: ReturnType<typeof useToast>, p: AgentProvisioning | null | undefined) {
  if (p?.status === "complete") toast.success("Your account and card are ready", { description: "Last step: activate your card." });
}

/**
 * Creates a passkey. Onboarding: the server then deploys the smart account and issues the card.
 * Settings (`additional`): an extra passkey for signing in; the account and card already exist.
 */
export function CreatePasskeyAction({ variant = "primary", icon, children, additional = false }: ActionStyle & { additional?: boolean }) {
  const { preview, refresh } = useAgentApp();
  const toast = useToast();
  if (preview) return <PreviewOnlyButton variant={variant} icon={icon}>{children}</PreviewOnlyButton>;
  return (
    <RegisterPasskeyButton
      className={actionClass(variant)}
      onRegistered={(res) => {
        if (additional) toast.success("Passkey added", { description: "You can sign in with it on this device." });
        else provisioningToast(toast, res.provisioning);
        void refresh();
      }}
    >
      {icon}
      {children}
    </RegisterPasskeyButton>
  );
}

/** Retries a failed smart account / card step (idempotent). */
export function RetrySetupAction({ variant = "primary", icon, children }: ActionStyle) {
  const { preview, refresh } = useAgentApp();
  const toast = useToast();
  if (preview) return <PreviewOnlyButton variant={variant} icon={icon}>{children}</PreviewOnlyButton>;
  return (
    <RetryProvisioningButton
      className={actionClass(variant)}
      onProvisioned={(res) => {
        provisioningToast(toast, res);
        void refresh();
      }}
    >
      {icon}
      {children}
    </RetryProvisioningButton>
  );
}
