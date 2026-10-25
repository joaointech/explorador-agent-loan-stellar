import { ArrowDownToLine, Coins, FileCheck, Inbox, Landmark, PiggyBank, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Address, TxLink } from "@/components/ui/address";
import { Amount } from "@/components/ui/amount";
import { Badge, StatusBadge, type BadgeTone, type StatusKind } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader, CardRow } from "@/components/ui/card";
import { Countdown } from "@/components/ui/countdown";
import { DateText } from "@/components/ui/date-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Container, Section } from "@/components/ui/layout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { StatPill } from "@/components/ui/stat-pill";
import { Stepper } from "@/components/ui/stepper";
import { DataTable } from "@/components/ui/table";
import { Eyebrow, Lead, PageHeader, TwoToneHeadline } from "@/components/ui/typography";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { formatEur } from "@/lib/format";

import { ChartsDemo, FormDemo, LiveInterestDemo, MidnightCountdown, OverlayDemos, PipelineDemo, TabsDemo } from "./demos";
import { SAMPLE_ACCOUNT, SAMPLE_CONTRACT, SAMPLE_DAY, SAMPLE_NOTES, SAMPLE_NOW, SAMPLE_TX } from "./sample-data";

export const metadata: Metadata = {
  title: "Design system",
  description: "Tokens, components and patterns of explorador advance, in light and dark.",
  robots: { index: false },
};

const NAV = [
  ["hero", "Hero"],
  ["tokens", "Tokens"],
  ["type", "Typography"],
  ["buttons", "Buttons"],
  ["cards", "Cards"],
  ["badges", "Badges"],
  ["data", "Data display"],
  ["forms", "Forms"],
  ["tabs", "Tabs"],
  ["overlays", "Dialogs, sheets, toasts"],
  ["progress", "Progress and steps"],
  ["tables", "Tables"],
  ["charts", "Charts"],
  ["feedback", "Loading and empty"],
  ["usage", "Usage notes"],
] as const;

function Showcase({ id, title, importPath, description, children }: { id: string; title: string; importPath?: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 border-t border-line py-10 sm:py-12">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-bold tracking-tight text-heading sm:text-2xl">
            {title}
          </h2>
          {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
        </div>
        {importPath && <code className="w-fit rounded-lg bg-card-muted px-2.5 py-1 font-mono text-xs text-muted ring-1 ring-line">{importPath}</code>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name, utility, className }: { name: string; utility: string; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`size-10 shrink-0 rounded-xl ring-1 ring-black/5 dark:ring-white/10 ${className}`} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-heading">{name}</p>
        <p className="truncate font-mono text-xs text-muted">{utility}</p>
      </div>
    </div>
  );
}

const SWATCHES: { name: string; utility: string; className: string }[] = [
  { name: "Canvas", utility: "bg-bg", className: "bg-bg" },
  { name: "Warm section", utility: "bg-section", className: "bg-section" },
  { name: "Warm section (alt)", utility: "bg-section-alt", className: "bg-section-alt" },
  { name: "Card", utility: "bg-card", className: "bg-card" },
  { name: "Card inset", utility: "bg-card-muted", className: "bg-card-muted" },
  { name: "Text", utility: "text-fg", className: "bg-fg" },
  { name: "Headline", utility: "text-heading", className: "bg-heading" },
  { name: "Muted text", utility: "text-muted", className: "bg-muted" },
  { name: "Card border", utility: "border-line", className: "bg-line" },
  { name: "Input border", utility: "border-border", className: "bg-border" },
  { name: "Primary", utility: "bg-primary", className: "bg-primary" },
  { name: "Primary hover", utility: "bg-primary-hover", className: "bg-primary-hover" },
  { name: "Primary soft", utility: "bg-primary-soft", className: "bg-primary-soft" },
  { name: "Primary tint", utility: "bg-primary-tint", className: "bg-primary-tint" },
  { name: "Primary text", utility: "text-primary-text", className: "bg-primary-text" },
  { name: "Success", utility: "text-success", className: "bg-success" },
  { name: "Warning", utility: "text-warning", className: "bg-warning" },
  { name: "Danger", utility: "text-danger", className: "bg-danger" },
  { name: "Chart 1", utility: "--color-chart-1", className: "bg-chart-1" },
  { name: "Chart 2", utility: "--color-chart-2", className: "bg-chart-2" },
  { name: "Chart 3", utility: "--color-chart-3", className: "bg-chart-3" },
];

const STATUSES: StatusKind[] = ["Active", "Settled", "Cancelled", "WrittenOff", "Overdue", "DRAFT", "PROVING", "FAILED", "PENDING", "SUBMITTED", "CONFIRMED", "APPROVED", "DECLINED"];
const TONES: BadgeTone[] = ["neutral", "blue", "emerald", "amber", "red", "orange", "violet"];

export default function DesignPage() {
  return (
    <>
      <Section tone="warm" spacing="md" dots>
        <PageHeader
          eyebrow="Design system"
          title="explorador advance"
          accent="UI kit"
          description="Every token, component and pattern in light and dark, ported from explorador.pt. Copy from here; flip the theme to check both."
          actions={<ThemeToggle />}
        />
        <nav aria-label="Sections" className="no-scrollbar mt-6 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
          {NAV.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="shrink-0 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-muted ring-1 ring-line transition-colors hover:text-primary-text"
            >
              {label}
            </a>
          ))}
        </nav>
      </Section>

      <Container>
        <Showcase id="hero" title="Hero pattern" importPath="@/components/ui/typography" description="Warm off-white band with the dotted grid, eyebrow, two-tone headline, lead, CTAs ending in →, and glass stat pills.">
          <div className="relative overflow-hidden rounded-panel border border-line bg-section px-5 py-10 sm:px-10 sm:py-14">
            <div aria-hidden className="bg-dot-grid pointer-events-none absolute inset-0 opacity-60" />
            <div className="relative max-w-3xl">
              <Eyebrow>What is explorador advance</Eyebrow>
              <TwoToneHeadline as="h3" size="display" accentStyle="gradient" lead="Close the deal." accent="Get paid today." className="mt-4" />
              <Lead className="mt-5">
                Agents spend part of their commission when the CPCV is signed. Investors fund the advances from a pool on Stellar and earn the
                interest.
              </Lead>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button href="/agent" size="lg" arrow>
                  I&apos;m an agent
                </Button>
                <Button href="/invest" size="lg" variant="secondary" arrow>
                  Invest
                </Button>
              </div>
              <Link href="/registry" className="mt-5 inline-block text-sm font-medium text-primary-text underline-offset-4 hover:underline">
                See every deal on-chain →
              </Link>
            </div>
            <div className="relative mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatPill variant="glass" label="Pool TVL" value={<Amount value="750000000000" decimals={0} />} icon={<Coins />} />
              <StatPill variant="glass" label="Senior APY" value="6.48%" hint="projected" icon={<TrendingUp />} />
              <StatPill variant="glass" label="Active notes" value="3" icon={<FileCheck />} />
              <StatPill variant="glass" label="Total advanced" value={<Amount value="98124000000" decimals={0} />} icon={<Wallet />} />
            </div>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <TwoToneHeadline lead="Every deal, on-chain." accent="No personal data." />
            <TwoToneHeadline size="card" lead="How your yield works" accent="interest → fee → senior → junior" breakLine={false} />
          </div>
        </Showcase>

        <Showcase id="tokens" title="Colour tokens" importPath="app/globals.css" description="Semantic variables flip with the theme (no dark: needed). Raw Tailwind palette classes still work, as on explorador.pt.">
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {SWATCHES.map((s) => (
              <Swatch key={s.utility} {...s} />
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-button border border-line bg-card p-4 text-sm">
              <p className="font-semibold text-heading">rounded-button</p>
              <p className="text-muted">12 px: buttons, inputs</p>
            </div>
            <div className="rounded-card border border-line bg-card p-4 text-sm">
              <p className="font-semibold text-heading">rounded-card</p>
              <p className="text-muted">16 px: cards, tables</p>
            </div>
            <div className="rounded-panel border border-line bg-card p-4 text-sm">
              <p className="font-semibold text-heading">rounded-panel</p>
              <p className="text-muted">24 px: hero tiles, dialogs</p>
            </div>
          </div>
        </Showcase>

        <Showcase id="type" title="Typography" importPath="@/components/ui/typography" description="Sora everywhere, 400/600/700. Headlines bold and tight; numbers use tabular figures.">
          <div className="flex flex-col gap-6">
            <div>
              <p className="mb-1 font-mono text-xs text-muted">display · h1 · 36 → 60 px</p>
              <TwoToneHeadline as="p" size="display" lead="Close the deal." accent="Get paid today." />
            </div>
            <div>
              <p className="mb-1 font-mono text-xs text-muted">section · h2 · 44 px, −1.1 px tracking</p>
              <TwoToneHeadline as="p" lead="Spend your commission" accent="before the escritura." />
            </div>
            <div>
              <p className="mb-1 font-mono text-xs text-muted">card · h3 · 24 px</p>
              <TwoToneHeadline as="p" size="card" lead="Available to spend" />
            </div>
            <div className="max-w-2xl">
              <p className="mb-1 font-mono text-xs text-muted">body · 16 px, relaxed</p>
              <p className="leading-relaxed text-fg">
                When a CPCV is signed, explorador proves the deal with a zero-knowledge proof. The proof reveals the commission and the agent, and hides the
                buyer, seller, price and property.
              </p>
              <p className="mt-3 text-sm text-muted">Muted 14 px for secondary text and help.</p>
            </div>
            <div className="flex flex-wrap items-end gap-6">
              <Eyebrow>Eyebrow label</Eyebrow>
              <Eyebrow tone="primary">Primary eyebrow</Eyebrow>
              <span className="text-4xl font-bold tracking-tight text-heading">€3,750.00</span>
              <span className="text-sm text-muted">1,111,111 vs 9,999,999 (tabular)</span>
            </div>
          </div>
        </Showcase>

        <Showcase id="buttons" title="Buttons" importPath="@/components/ui/button" description="rounded-xl, 600 weight, h-11 by default. Forward actions end with →. Pass href for links.">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button arrow>Primary</Button>
              <Button variant="secondary" arrow>
                Secondary
              </Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Write off</Button>
              <Button loading>Saving</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg" arrow>
                Large (hero)
              </Button>
              <Button variant="secondary" icon={<ArrowDownToLine className="size-4" />}>
                With icon
              </Button>
              <IconButton label="Copy address" variant="secondary">
                <Wallet className="size-5" />
              </IconButton>
              <Button href="https://stellar.expert/explorer/testnet" variant="ghost" arrow>
                External link
              </Button>
            </div>
            <Card variant="brand" radius="3xl" padding="lg">
              <Eyebrow tone="onPrimary">On brand surfaces</Eyebrow>
              <p className="mt-2 max-w-xl text-lg font-bold">Use the white button on blue tiles and banners.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button variant="onPrimary" arrow>
                  Get 10,000 tEURC
                </Button>
              </div>
            </Card>
          </div>
        </Showcase>

        <Showcase id="cards" title="Cards" importPath="@/components/ui/card" description="White, 16 or 24 px radius, 1 px slate-200/70 border, no heavy shadow. Glass over warm sections; brand gradient for one hero tile per view.">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader eyebrow="Agents" title="Spend before the escritura" description="CPCV on a €300,000 sale at 5%: €3,750.00 credit the same day." />
              <div className="mt-4">
                <CardRow label="Total commission" value={<Amount value="150000000000" />} />
                <CardRow label="Agent share" value={<Amount value="75000000000" />} />
                <CardRow label="Credit limit" value={<Amount value="37500000000" />} />
              </div>
            </Card>
            <Card variant="brand" radius="3xl">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <PiggyBank className="size-6" />
              </span>
              <p className="mt-4 text-lg font-bold">Investors</p>
              <p className="mt-1 text-sm leading-relaxed text-blue-50/90">Deposit tEURC, earn up to 8% APY first, take losses last.</p>
            </Card>
            <Card interactive>
              <CardHeader eyebrow="explorador" title="First-loss capital" description="Junior tranche absorbs write-offs before investors." action={<StatusBadge status="Active" />} />
              <p className="mt-4 text-sm text-muted">Interactive card: hover lifts it.</p>
            </Card>
          </div>
          <div className="mt-4 rounded-panel bg-section p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card variant="glass">
                <CardHeader title="Glass card" description="bg-white/60 + border, for cards over warm or coloured sections." />
              </Card>
              <Card variant="muted">
                <CardHeader title="Muted card" description="Inset panel for secondary groups inside pages and cards." />
              </Card>
            </div>
          </div>
        </Showcase>

        <Showcase id="badges" title="Badges and statuses" importPath="@/components/ui/badge" description="Active blue, Settled emerald, Cancelled amber, Written off red, Overdue orange outline; plus CPCV, chain and card states.">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusBadge key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <Badge key={t} tone={t}>
                  {t}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <Badge key={t} tone={t} variant="outline">
                  {t}
                </Badge>
              ))}
              <Badge tone="blue" variant="solid" icon={<ShieldCheck />}>
                Verified on-chain
              </Badge>
              <Badge tone="neutral" size="md">
                Virtual · Sandbox
              </Badge>
            </div>
          </div>
        </Showcase>

        <Showcase id="data" title="Data display" importPath="@/components/ui/{amount,date-text,address,countdown}" description="Amounts arrive as stroops strings; dates as day numbers, unix seconds or ISO; addresses link to stellar.expert.">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Amount" />
              <div className="mt-3">
                <CardRow label='value="37500000000" (stroops)' value={<Amount value="37500000000" />} />
                <CardRow label='value={6200} unit="cents"' value={<Amount value={6200} unit="cents" />} />
                <CardRow label='sign="always" tone="auto"' value={<Amount value="44112328767" sign="always" tone="auto" />} />
                <CardRow label="negative, tone auto" value={<Amount value="-20000000000" tone="auto" />} />
                <CardRow label="compact" value={<Amount value="650000000000" compact />} />
                <CardRow label="null" value={<Amount value={null} />} />
              </div>
              <p className="mt-4 text-4xl font-bold tracking-tight text-heading">
                <Amount value="44112328767" subtleCents />
              </p>
            </Card>
            <Card>
              <CardHeader title="Dates, countdowns, addresses" />
              <div className="mt-3">
                <CardRow label="Day number" value={<DateText value={SAMPLE_DAY + 45} />} />
                <CardRow label="Unix seconds, date + time" value={<DateText value={SAMPLE_NOW} format="datetime" />} />
                <CardRow label="Relative to protocol now" value={<DateText value={SAMPLE_DAY + 45} format="relative" now={SAMPLE_NOW} />} />
                <CardRow label="Countdown (days)" value={<Countdown to={SAMPLE_DAY + 45} now={SAMPLE_NOW} />} />
                <CardRow label="Countdown overdue" value={<Countdown to={SAMPLE_DAY - 3} now={SAMPLE_NOW} />} />
                <CardRow label="Precise, wall clock" value={<MidnightCountdown />} />
                <CardRow label="Smart account" value={<Address address={SAMPLE_CONTRACT} label="smart account" />} />
                <CardRow label="Investor" value={<Address address={SAMPLE_ACCOUNT} head={6} tail={6} label="investor account" />} />
                <CardRow label="Transaction" value={<TxLink hash={SAMPLE_TX} />} />
              </div>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <LiveInterestDemo />
            <Card variant="muted" padding="sm">
              <p className="text-[10px] font-semibold tracking-[0.2em] text-muted uppercase">Full address</p>
              <div className="mt-2">
                <Address address={SAMPLE_CONTRACT} full label="contract" />
              </div>
            </Card>
          </div>
        </Showcase>

        <Showcase id="forms" title="Forms" importPath="@/components/ui/{field,number-input}" description="Field wires label, hint and error to the control. Inputs are h-11 with 16 px text (no iOS zoom) and a blue focus ring.">
          <Card padding="lg">
            <FormDemo />
          </Card>
        </Showcase>

        <Showcase id="tabs" title="Tabs" importPath="@/components/ui/tabs" description="Segmented pill tabs for panels; underline tabs for page sections. Arrow keys move between tabs.">
          <TabsDemo />
        </Showcase>

        <Showcase id="overlays" title="Dialogs, sheets and toasts" importPath="@/components/ui/{dialog,toast}" description="Dialog is centered; Sheet slides up from the bottom on phones. Toasts stack bottom-right with a countdown rail.">
          <OverlayDemos />
        </Showcase>

        <Showcase id="progress" title="Progress and steps" importPath="@/components/ui/{progress-bar,stepper}" description="Credit used, leverage against the 10× cap, onboarding and the CPCV proof pipeline.">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col gap-5">
              <ProgressBar label="Credit used" value={26_250_000_000n} max={37_500_000_000n} tone="auto" showValue valueText={`${formatEur("26250000000")} of ${formatEur("37500000000")}`} />
              <ProgressBar label="Leverage" value={245} max={1000} showValue valueText="2.45× of 10× cap" marker={0.8} />
              <ProgressBar label="Utilization" value={92} tone="auto" showValue size="lg" />
              <ProgressBar label="Coverage (junior / total)" value={11} tone="emerald" size="sm" showValue />
            </Card>
            <Card>
              <p className="mb-4 text-sm font-semibold text-heading">Agent onboarding</p>
              <Stepper
                orientation="horizontal"
                label="Onboarding"
                steps={[
                  { id: "email", label: "Email", status: "done" },
                  { id: "passkey", label: "Passkey", status: "done" },
                  { id: "card", label: "Card created", status: "active" },
                  { id: "activate", label: "Activate card", status: "idle" },
                ]}
              />
              <p className="mt-6 mb-4 text-sm font-semibold text-heading">With an error</p>
              <Stepper
                orientation="horizontal"
                label="Onboarding with error"
                steps={[
                  { id: "email", label: "Email", status: "done" },
                  { id: "passkey", label: "Passkey", status: "error" },
                  { id: "card", label: "Card created", status: "idle" },
                  { id: "activate", label: "Activate card", status: "idle" },
                ]}
              />
            </Card>
          </div>
          <Card className="mt-4" padding="lg">
            <CardHeader title="CPCV pipeline" description="Validating → Signing attestation → Generating ZK proof → Verifying proof locally → Minting note on Stellar → Done" />
            <div className="mt-6">
              <PipelineDemo />
            </div>
          </Card>
        </Showcase>

        <Showcase id="tables" title="Tables" importPath="@/components/ui/table" description="DataTable from a column list; the container scrolls sideways inside its card so the page never does. Columns can hide below a breakpoint.">
          <DataTable
            caption="Registry sample: public data only, never names."
            rows={SAMPLE_NOTES}
            rowKey={(n) => n.id}
            columns={[
              { key: "id", header: "Note", cell: (n) => <span className="font-semibold text-heading">#{n.id}</span> },
              { key: "agent", header: "Agent", cell: (n) => <Address address={n.agent} label="agent smart account" /> },
              { key: "total", header: "Commission", align: "right", cell: (n) => <Amount value={n.totalCommission} /> },
              { key: "limit", header: "Credit limit", align: "right", hideBelow: "md", cell: (n) => <Amount value={n.creditLimit} /> },
              { key: "escritura", header: "Escritura", cell: (n) => <DateText value={n.escrituraDay} /> },
              {
                key: "status",
                header: "Status",
                cell: (n) => (
                  <span className="flex gap-1.5">
                    <StatusBadge status={n.status} />
                    {n.overdue && <StatusBadge status="Overdue" />}
                  </span>
                ),
              },
              { key: "minted", header: "Minted", hideBelow: "lg", cell: (n) => (n.mintTxHash ? <TxLink hash={n.mintTxHash} /> : <span className="text-subtle">—</span>) },
            ]}
          />
          <div className="mt-4">
            <DataTable
              rows={[] as typeof SAMPLE_NOTES}
              rowKey={(n) => n.id}
              columns={[
                { key: "id", header: "Note", cell: (n) => `#${n.id}` },
                { key: "status", header: "Status", cell: (n) => <StatusBadge status={n.status} /> },
              ]}
              empty={<EmptyState variant="plain" icon={<Inbox />} title="No notes match" description="Try another status filter or search by note id." />}
            />
          </div>
        </Showcase>

        <Showcase id="charts" title="Charts" importPath="@/components/ui/charts" description="Recharts wrappers: 2 px lines, light-blue wash, hairline grid, crosshair tooltip with every series, legend for 2+ series, a screen-reader table. Max 3 series; one y-axis.">
          <ChartsDemo />
        </Showcase>

        <Showcase id="feedback" title="Loading and empty states" importPath="@/components/ui/{skeleton,empty-state,stat-pill}">
          <div className="grid gap-4 md:grid-cols-3">
            <Card aria-busy className="flex flex-col gap-3">
              <Skeleton className="h-5 w-1/2" />
              <SkeletonText lines={3} />
              <Skeleton className="h-11 w-full rounded-xl" />
            </Card>
            <StatPill label="Available to spend" value="" loading size="lg" />
            <EmptyState
              icon={<Landmark />}
              title="No deals yet"
              description="Your CPCV Notes appear here once explorador mints them."
              action={
                <Button size="sm" variant="secondary" href="/registry" arrow>
                  Browse the registry
                </Button>
              }
            />
          </div>
        </Showcase>

        <Showcase id="usage" title="Usage notes" description="Conventions the other screens follow.">
          <Card>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-fg marker:text-subtle">
              <li>
                Format with <code className="font-mono text-xs">@/lib/format</code>: <code className="font-mono text-xs">formatEur(stroops)</code> → €3,750.00,{" "}
                <code className="font-mono text-xs">formatDate(day | unix | iso)</code> → 14 Jan 2027 (Europe/Lisbon),{" "}
                <code className="font-mono text-xs">truncateAddress</code>, <code className="font-mono text-xs">formatPercent</code>,{" "}
                <code className="font-mono text-xs">formatBps</code>, <code className="font-mono text-xs">explorerTxUrl</code>.
              </li>
              <li>
                Use semantic colour utilities (<code className="font-mono text-xs">bg-card text-heading text-muted border-line bg-section text-primary-text</code>) so dark
                mode is automatic. <code className="font-mono text-xs">cn()</code> merges classes, so a <code className="font-mono text-xs">className</code> override wins.
              </li>
              <li>
                Icons: lucide-react 1.x at 1.5 px stroke (set globally). Renamed icons: CircleCheck (not CheckCircle2), CircleAlert, TriangleAlert, LoaderCircle,
                CircleX.
              </li>
              <li>
                Protocol time comes from the API (<code className="font-mono text-xs">protocolNow</code>); tick it with{" "}
                <code className="font-mono text-xs">useProtocolNow(protocolNow, fetchedAtMs)</code>; never use the wall clock for deals or interest.
              </li>
              <li>
                After a demo-clock change call <code className="font-mono text-xs">refreshDemoClock()</code> from{" "}
                <code className="font-mono text-xs">@/components/shell/demo-clock</code> to update the header chip at once.
              </li>
              <li>Mobile first: 16 px gutter (Container / Section), no horizontal page scroll at 375 px, touch targets ≥ 44 px.</li>
            </ul>
          </Card>
        </Showcase>
      </Container>
    </>
  );
}
