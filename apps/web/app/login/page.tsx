// /login: passkey sign-in or email → 6-digit code (spec §4.2 step 1, §9.2),
// styled with the design system: a warm band with the sign-in card, and the
// product pitch beside it from `lg`. A signed-in visitor gets "Continue / sign
// out" instead of a redirect (see DECISIONS.md, Auth and database).

import { FingerprintPattern, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/layout";
import { Eyebrow, Lead, TwoToneHeadline } from "@/components/ui/typography";
import { postLoginPath, sanitizeNextPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";

import { LoginForm } from "./login-form";
import { SignedInPanel } from "./signed-in-panel";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-card text-primary-text shadow-card ring-1 ring-line [&_svg]:size-5">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-heading">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = sanitizeNextPath(Array.isArray(next) ? next[0] : next) ?? undefined;
  const user = await getSessionUser();

  return (
    <Section tone="warm" dots spacing="lg" className="min-h-full" innerClassName="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="hidden lg:block">
        <Eyebrow>explorador advance</Eyebrow>
        <TwoToneHeadline as="p" lead="Close the deal." accent="Get paid today." className="mt-4" />
        <Lead className="mt-5">Agents spend part of their commission as soon as the CPCV is signed, with a card funded on Stellar.</Lead>
        <ul className="mt-8 flex max-w-md flex-col gap-5">
          <Point icon={<FingerprintPattern />} title="Passkey sign-in">
            Face ID, Touch ID or your phone&apos;s screen lock. No passwords, no wallet, no seed phrase.
          </Point>
          <Point icon={<Wallet />} title="Spend before the escritura">
            Half of your commission becomes credit on your card the day the deal is proven on-chain.
          </Point>
          <Point icon={<ShieldCheck />} title="Private by design">
            Zero-knowledge proofs show the deal exists, never the buyer, the seller or the price.
          </Point>
        </ul>
      </div>

      <div className="mx-auto w-full max-w-md lg:mx-0 lg:justify-self-end">
        <Card radius="3xl" padding="lg">
          {user ? <SignedInPanel email={user.email} role={user.role} continueTo={postLoginPath(user.role, nextPath)} /> : <LoginForm next={nextPath} />}
        </Card>
        <p className="mt-6 text-center text-xs text-muted">Testnet demo · not financial advice</p>
      </div>
    </Section>
  );
}
