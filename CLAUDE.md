# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Packet-OSS is an open-source GPU cloud platform dashboard built with Next.js 16. It manages customer GPU pod rentals via hosted.ai, Stripe billing with prepaid wallets, and an admin panel. The database is SQLite via Prisma.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (Next.js)
pnpm build            # Production build (clears .next/cache, preserves live build)
pnpm lint             # ESLint with next config
pnpm test             # Vitest (watch mode)
pnpm test:unit        # Vitest single run
pnpm test:e2e         # Playwright end-to-end tests
pnpm test:e2e:headed  # Playwright with browser visible
npx tsc --noEmit      # Type check without emitting
```

## Type Checking

Always run `pnpm build` or `npx tsc --noEmit` to verify changes. The project uses strict TypeScript (`strict: true` in tsconfig). Path alias `@/*` maps to `./src/*`.

## Testing

- **Unit/integration tests**: Vitest with `tests/**/*.test.{ts,tsx}` (excludes `tests/e2e/`). Environment is `node`. Setup file at `tests/setup.ts`.
- **E2E tests**: Playwright, configured in `playwright.config.ts`.
- Coverage thresholds: 70% across lines, functions, branches, statements.

## Production Deployment

See `.claude/DEPLOY.md` (gitignored) for server details and deploy commands.

- **Process manager**: PM2 with `ecosystem.config.cjs` (max 10 restarts, 2s delay)
- **Zero-downtime**: The build preserves `.next/server` and `.next/static` so the live app keeps serving while the new build compiles. Only `.next/cache` is cleared.

## Architecture

### Stack

- **Framework**: Next.js 16 (App Router, React 19, Tailwind CSS 4)
- **Database**: SQLite with Prisma ORM (`prisma/schema.prisma`)
- **Payments**: Stripe (subscriptions, charges, prepaid wallets)
- **GPU Infrastructure**: hosted.ai API for pod management
- **Validation**: Zod
- **Auth**: JWT tokens (jsonwebtoken) -- no NextAuth

### Source Layout

```
src/
  app/                  # Next.js App Router
    (marketing)/        # Public marketing pages (grouped route)
    account/            # Customer account page
    admin/              # Admin panel (SPA with tab routing via ?tab=)
    api/                # API routes
      admin/            # Admin API endpoints
      cron/             # Cron job endpoints (midnight-status-email, etc.)
      webhooks/         # Stripe webhook handlers
    dashboard/          # Customer dashboard
    terminal/           # Web SSH terminal
  components/           # Shared React components
  hooks/                # Shared React hooks
  lib/                  # Server-side business logic
    auth/               # Admin + customer JWT auth modules
    email/              # Email templates (HTML inline-styled)
    voucher/            # Voucher system
    referral/           # Referral system
    hostedai/           # hosted.ai API client
    zammad/             # Support ticket integration
  middleware.ts         # Blocks bogus POST to non-API routes (no server actions exist)
  server/               # SSH WebSocket server (tsx src/server/ssh-websocket.ts)
tests/                  # Vitest unit/integration + Playwright E2E
prisma/schema.prisma    # Database schema
```

### Authentication Pattern

Two separate auth systems, both using JWT:

1. **Admin auth** (`src/lib/auth/admin.ts`): Email-based with 2FA (TOTP). Session tokens stored in `admin_session` cookie. API routes verify via `verifySessionToken()`.
2. **Customer auth** (`src/lib/auth/customer.ts`): Stripe customer-based. Generates tokens with `generateCustomerToken()`, verified via `verifyCustomerToken()`.
3. **Cron auth** (`src/lib/cron-auth.ts`): `CRON_SECRET` header for scheduled jobs.

### Admin Panel Tab System

The admin panel is a single-page app at `/admin` with tab-based routing via `?tab=` query param. When adding a new tab:

1. Add to `AdminTab` type in `src/app/admin/types.ts`
2. Add to `VALID_ADMIN_TABS` array in `src/app/admin/hooks/useAdminData.ts` (required for URL routing)
3. Create tab component in `src/app/admin/components/`
4. Export from `src/app/admin/components/index.ts`
5. Add to sidebar in `AdminSidebar.tsx`
6. Add label in `AdminDashboard.tsx` `getTabLabel()`
7. Add render case in `AdminDashboard.tsx`
8. Create API route at `src/app/api/admin/[tabname]/route.ts` if needed

### Stripe Integration

- `getStripe()` in `src/lib/stripe.ts` is a lazy singleton.
- Customers have Stripe-managed wallets (negative balance = credit). Wallet operations in `src/lib/wallet.ts`.
- GPU pods link to Stripe via `PodMetadata.stripeCustomerId` and optional `stripeSubscriptionId`.
- Webhook handling in `src/app/api/webhooks/`.

### hosted.ai Integration

GPU pod lifecycle management through hosted.ai API. Client in `src/lib/hostedai.ts` and `src/lib/hostedai/`. Pod metadata (display names, billing info, startup scripts) stored locally in Prisma `PodMetadata` table. Metrics collected by `src/lib/metrics-collector.ts` into `PodMetricsHistory`.

### Email System

HTML email templates with inline styles in `src/lib/email/templates/`. Uses direct SMTP/API sending (not a templating service). The midnight status email (`midnight-status-email/route.ts`) is a daily cron that collects KPIs from Stripe and Prisma.

### Middleware

`src/middleware.ts` blocks all POST requests to non-API routes (returns 405). This exists because no server actions are used -- bots sending POST to page routes would trigger Next.js server action errors.

## Key Conventions

- Amounts are stored in **cents** (integer) throughout the codebase (`walletRevenueCents`, `mrrCents`, `pricePerHourCents`).
- Stripe customer `balance` is negative for credits (use `Math.abs(Math.min(0, balance))`).
- The hosted.ai team ID is stored in Stripe customer `metadata.team_id`.
- Pod status values from hosted.ai: `"running"`, `"active"`, `"subscribed"`, `"stopped"`, etc.
- Cron routes support both POST and GET (GET calls POST for manual testing).

## Important Rules

- Never deploy incomplete features. All linked pages must exist before pushing.
- Always run `pnpm build` to verify before deploying.
- Environment variables go in `.env.local` (never committed). Check `.env.example` or Prisma schema for required vars.
