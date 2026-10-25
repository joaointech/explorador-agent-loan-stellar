"use client";

import { ArrowDownToLine, ChevronDown, CreditCard, KeyRound, LogOut, Mail, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";

import { signOut } from "@/components/shell/nav";
import { Address } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DateText } from "@/components/ui/date-text";
import { useToast } from "@/components/ui/toast";

import { AgentAction, CreatePasskeyAction } from "./actions";
import { useAgentApp } from "./context";
import { cardState, withdrawable, type Overview } from "./state";

/** A settings row: icon, label, details; an optional action spans the full width below. */
function Setting({ icon, label, children, action }: { icon: ReactNode; label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-4">
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-card-muted text-muted ring-1 ring-line [&_svg]:size-[18px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-heading">{label}</h3>
          <div className="mt-1 text-sm text-muted">{children}</div>
        </div>
      </div>
      {action && <div className="mt-3 sm:pl-12">{action}</div>}
    </div>
  );
}

const CARD_STATUS: Record<ReturnType<typeof cardState>, { label: string; tone: "emerald" | "neutral" | "amber" }> = {
  active: { label: "Active", tone: "emerald" },
  inactive: { label: "Not active yet", tone: "neutral" },
  paused: { label: "Paused", tone: "amber" },
  none: { label: "Not issued yet", tone: "neutral" },
};

/** Email, passkeys, card controls, "Withdraw balance to my account", and the smart account under "Advanced". */
export function SettingsSection({ data }: { data: Overview }) {
  const { preview } = useAgentApp();
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const card = cardState(data);
  const amount = withdrawable(data);
  const passkeys = data.user.passkeys ?? [];
  const demo = data.agent.signerKind === "demo-ed25519";
  const status = CARD_STATUS[card];

  return (
    <Card radius="3xl" padding="md">
      <CardHeader titleAs="h2" title="Settings" />
      <div className="mt-1 divide-y divide-line">
        <Setting icon={<Mail />} label="Email">
          <span className="break-all text-fg">{data.user.email}</span>
        </Setting>

        <Setting
          icon={<KeyRound />}
          label="Passkeys"
          action={
            data.onboarding.smartAccount ? (
              <>
                <CreatePasskeyAction variant="secondary" additional>
                  Add a passkey on this device
                </CreatePasskeyAction>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">Extra passkeys can sign in. Card actions stay with the passkey that created your account.</p>
              </>
            ) : undefined
          }
        >
          {passkeys.length === 0 ? (
            <p>{demo ? "Seed account: sign in with the email code. Its smart account is signed by a server-held demo key." : "No passkey yet."}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {passkeys.map((p, i) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>
                    <span className="text-fg">{passkeys.length > 1 ? `Passkey ${i + 1}` : "Passkey"}</span> · added <DateText value={p.createdAt} />
                  </span>
                  {p.signer && <Badge tone="blue">Signs card actions</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Setting>

        {card !== "none" && (
          <Setting
            icon={<CreditCard />}
            label="Card"
            action={
              card === "active" ? (
                <AgentAction action={{ action: "disable_card" }} variant="secondary">
                  Pause card
                </AgentAction>
              ) : card === "paused" ? (
                <AgentAction action={{ action: "enable_card" }} variant="secondary">
                  Resume card
                </AgentAction>
              ) : undefined
            }
          >
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
              <span className="font-mono text-fg">•••• {data.agent.cardLast4}</span>
            </p>
          </Setting>
        )}

        {data.onboarding.smartAccount && (
          <Setting
            icon={<ArrowDownToLine />}
            label="Card balance"
            action={
              amount > 0n ? (
                <AgentAction action={{ action: "withdraw_balance", amount: amount.toString() }} variant="secondary">
                  Withdraw balance to my account
                </AgentAction>
              ) : (
                <Button variant="secondary" fullWidth disabled>
                  Withdraw balance to my account
                </Button>
              )
            }
          >
            <p>
              <Amount value={amount} className="font-semibold text-fg" /> can move to your smart account on Stellar, as tEURC.
            </p>
          </Setting>
        )}
      </div>

      {data.agent.smartAccount && (
        <details className="group mt-1 rounded-card border border-line bg-card-muted">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-heading [&::-webkit-details-marker]:hidden">
            <Wrench aria-hidden className="size-4 text-muted" />
            Advanced
            <ChevronDown aria-hidden className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <dl className="flex flex-col gap-3 border-t border-line px-4 py-4 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Smart account</dt>
              <dd>
                <Address address={data.agent.smartAccount} label="smart account" />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Signer</dt>
              <dd className="text-fg">{demo ? "Demo signer (Ed25519, held by the server for seed accounts)" : "Your passkey (secp256r1 / WebAuthn)"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Card on-chain</dt>
              <dd className="text-fg">{data.agent.cardEnabledOnChain ? "Enabled: explorador may draw on your credit when you pay" : "Disabled"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-muted">Network</dt>
              <dd className="text-fg">Stellar testnet · fees paid by explorador</dd>
            </div>
          </dl>
        </details>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="mt-3"
        loading={signingOut}
        icon={<LogOut aria-hidden className="size-4" />}
        onClick={() => {
          if (preview) {
            toast.info("Preview only", { description: "Signing out is disabled in the preview gallery." });
            return;
          }
          setSigningOut(true);
          void signOut();
        }}
      >
        Sign out
      </Button>
    </Card>
  );
}
