# Decisions

Choices made where `spec.md` was silent, or where the product owner gave new direction. Each workstream appends to its own section (keeps parallel branches merge-friendly). Format: `- YYYY-MM-DD: decision (why)`.

## Product and scope

- 2026-10-25: **Standalone hackathon project**: new database and new API; no integration with explorador.pt / irrealista (product owner). `../irrealista` and `../explorador-house-flash-loan` are read-only design/code inspiration only.
- 2026-10-25: Domain is **advance.explorador.ai** (product owner). Production `WEBAUTHN_RP_ID=advance.explorador.ai`; `localhost` in dev. Default `EMAIL_FROM` uses `advance@explorador.ai`; seed agents keep the spec's `@demo.explorador.pt` addresses (never emailed).
- 2026-10-25: Liquidity model as in the spec: one pooled senior vault (`eaSR`) backed by all CPCV Notes, with explorador's junior first-loss tranche.

## Engineering (repo-wide)

- 2026-10-25: Monorepo as in spec §6 with pnpm 9 workspaces. Next.js 16.4.3 / React 19.3 / Tailwind CSS 4.3 (latest stable at kickoff).
- 2026-10-25: Local Postgres is exposed on host port **5433** (5432 is often taken by a local install).
- 2026-10-25: Root-level `scripts/` is a workspace package (`@advance/scripts`) run with `tsx`; it imports shared code from `apps/web/lib` through the `@/` alias, so modules shared with scripts must not import `server-only`.
- 2026-10-25: API amounts are decimal strings of stroops (bigint-safe); shared request/response types live in `apps/web/lib/types/api.ts`.
- 2026-10-25: Node **24 LTS** pinned per project via `.npmrc` `use-node-version` (Prisma 7 rejects the machine's Node 23); run Node tools through pnpm.
- 2026-10-25: Prisma 7 uses the `prisma-client` generator (output `apps/web/lib/generated/prisma`, generated on `postinstall`), `prisma.config.ts` for the datasource URL, and the `@prisma/adapter-pg` driver adapter for both local Postgres and Neon.
- 2026-10-25: Next.js `cacheComponents` is **off** (dynamic-by-default model): nearly every page shows live chain state. Route protection uses Next 16 `proxy.ts` (Middleware was renamed).
- 2026-10-25: Workstreams build against stub interfaces committed up front (`lib/auth/session.ts`, `lib/stellar/contracts.ts`, `lib/stellar/smart-account.ts`, `lib/lithic/cards.ts`, `lib/zk/agent-field.ts`, `contracts/shared`), so they can run in parallel; each owner replaces its stubs.

- 2026-10-25: Contracts use **soroban-sdk 28.0.0**, not 29.x: OpenZeppelin `stellar-tokens`/`stellar-access`/`stellar-macros` 0.8.0 require `soroban-sdk ^28`, and mixing SDK majors breaks the build. Rust **1.94.0** is pinned in `contracts/rust-toolchain.toml` (SDK 28 needs ≥ 1.91).
- 2026-10-25: `soroban-fixed-point-math` is **not used**: 1.5.0 depends on `soroban-sdk ^25`, which would pull a second SDK into the build. Mul-div with explicit rounding is implemented in `contracts/shared/src/math.rs`.
- 2026-10-25: Contract events use `#[contractevent]` with default settings: first topic = snake_case struct name (`note_minted`, `card_draw`, …), fields in the data map. SEP-56 `Deposit`/`Withdraw` follow the standard's layout.

## Contracts: advance_pool and teurc

## ZK circuit and cpcv_note

## Web: design system and shell

- 2026-10-25: Where explorador.pt's code (`irrealista/web-public`) differs from the spec §10.1 samples, the code wins: Sora is self-hosted with `next/font/local` (the site's `Sora.woff2` variable font + OFL licence in `app/fonts/`) instead of `next/font/google` (also no build-time network fetch); warm bands are `stone-50` / `stone-100` (`--color-section`, `--color-section-alt`), not `#f6f5f1`; hero h1 is 36 px on phones (60 px at `xl`); primary buttons hover to navy (`--color-primary-hover: #0f172a`), as explorador.pt's CTAs do; header and footer turn slate-900 in dark mode; nav dividers are `blue-200/60`.
- 2026-10-25: Eyebrows use slate-500 (spec value) rather than the site's slate-400, which fails WCAG AA contrast on white.
- 2026-10-25: Tokens are semantic CSS variables in `@theme static` (`bg-card`, `text-heading`, `text-muted`, `border-line`, `bg-section`, `text-primary-text`, …) overridden by a `.dark` class on `<html>`, so components need no `dark:` variants. Dark mode is class-based (`@custom-variant dark`), Light/System/Dark persisted in `localStorage.theme` (same key and rule as explorador.pt) and applied by a render-blocking head script (Next.js "preventing flash" inline-script pattern).
- 2026-10-25: Added `tailwind-merge` 3.7.0 (configured with our tokens in `components/ui/cn.ts`): without it a consumer's `className` could not reliably override a primitive's defaults (e.g. `hidden` vs `inline-flex`), which broke the mobile header during development.
- 2026-10-25: The app shell (header, footer, toasts, theme sync, lucide 1.5 px stroke via `LucideProvider`) lives in the root layout, so every page gets it without route groups.
- 2026-10-25: The header reads `getSessionUser()` inside try/catch (with `unstable_rethrow`), treating any failure as signed out. Sign out POSTs to `/api/auth/logout` (constant `SIGN_OUT_ENDPOINT` in `components/shell/nav.ts`; the auth workstream implements the route) and then does a full reload so no client cache survives.
- 2026-10-25: Demo clock chip: one shared poller of `GET /api/pool/stats` every 30 s (paused while the tab is hidden) behind `useDemoClock()`; `refreshDemoClock()` lets the admin panel update it right after a fast-forward. Desktop shows a chip in the bar; phones get a slim strip under the header. Offsets under a day show as hours (`+3h`).
- 2026-10-25: Dates are formatted by hand from `Intl` parts (fixed three-letter months) because en-GB ICU now prints "Sept"; day numbers are formatted as UTC calendar days, instants in Europe/Lisbon. Money stays in bigint until Intl formats an exact decimal string; stroops round to the nearest cent, half away from zero.
- 2026-10-25: Chart series colours are a fixed order validated for colour-vision deficiency on both surfaces (brand blue-600/blue-500, orange, aqua; dataviz validator CVD ΔE ≥ 9). Charts take at most 3 series and one y-axis; they use CSS variables so they follow the theme without JS, and include a screen-reader data table.
- 2026-10-25: Dialog and Sheet are built on the native `<dialog>` (focus trap, Escape, inert page); Sheet is a bottom sheet below `sm` and a centered dialog above.
- 2026-10-25: App icons are static files rendered once from explorador's mark (`app/icon.png` 192 px and a 16/32/48 `favicon.ico` with explorador.pt's 20 % rounded tile; `app/apple-icon.png` 180 px full-bleed); the manifest reuses explorador's `icon-192/512.png`.
- 2026-10-25: Pure formatting helpers stay free of `@/` imports so Vitest runs without a config file (no shared `vitest.config.ts` was added).

## Web: landing and registry pages

## Auth and database

## Stellar service and indexer

## Smart accounts (agent passkey wallet)

## Card (Lithic ASA)

## Agent app

## Invest dashboard

## Admin panel and CPCV pipeline

## Deploy, seed and e2e
