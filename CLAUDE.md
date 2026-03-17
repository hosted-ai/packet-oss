# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Packet.ai (`dash.packet.ai`) is a GPU cloud platform dashboard built with Next.js 16. It manages customer GPU pod rentals via hosted.ai, Stripe billing with prepaid wallets, an OpenAI-compatible inference API ("Token Factory"), and an admin panel. The database is MariaDB/MySQL via Prisma.

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
- **Database**: MariaDB/MySQL with Prisma ORM (`prisma/schema.prisma`)
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
      cron/             # Cron job endpoints (midnight-status-email, process-batches, etc.)
      v1/               # Token Factory OpenAI-compatible API
      webhooks/         # Stripe webhook handlers
    dashboard/          # Customer dashboard
    terminal/           # Web SSH terminal
  components/           # Shared React components
  hooks/                # Shared React hooks
  lib/                  # Server-side business logic
    auth/               # Admin + customer JWT auth modules
    email/              # Email templates (HTML inline-styled)
    token-factory/      # LLM inference orchestration
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

### Token Factory (LLM Inference API)

OpenAI-compatible endpoints at `/api/v1/` (chat/completions, completions, embeddings, batches, models). Routes through multiple vLLM servers with intelligent load-based routing. Key files:

- `src/lib/token-factory/index.ts` -- Core orchestration, server selection, cost calculation
- `src/lib/token-factory/lora.ts` -- LoRA adapter training via SSH
- Pricing: pay-per-token from wallet, tracked in `InferenceUsage` table

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
- **Bug fix workflow**: When a bug is reported, don't start by trying to fix it. Instead, start by writing a test that reproduces the bug. Then, have subagents try to fix the bug and prove it with a passing test.

---

## OSS Export Pipeline

This repo (Packet.ai / Pro) is the single source of truth. The open-source edition ("GPU Cloud Dashboard") is a **derived build artifact** generated by an export script. Code flows one way: Pro → OSS. Never edit the OSS output directly.

### How It Works

```
packet/ (Pro repo, private)
  ├── src/                    ← All application code lives here
  ├── oss/                    ← OSS-only overlay files (README, install scripts, CLI, etc.)
  ├── .oss-manifest.yaml      ← Controls what gets excluded, overlaid, and overridden
  └── scripts/export-oss.ts   ← The export pipeline script
          │
          │  npx tsx scripts/export-oss.ts --output ../packet-oss
          ▼
packet-oss/ (OSS repo, public)  ← Read-only output, wiped on each export
```

The pipeline:
1. `git archive HEAD` → clean copy of committed code (respects .gitignore)
2. Delete files matching `exclude:` patterns from `.oss-manifest.yaml`
3. Copy `overlay:` files from `oss/` into the output (replaces README, .env.example, adds install scripts, CLI, etc.)
4. Patch `package.json` with `overrides:` (name → `gpu-cloud-dashboard`, license → MIT)
5. Set `NEXT_PUBLIC_EDITION=oss` in `.env.example`
6. Remove `.oss-manifest.yaml` and `oss/` directory from output
7. Verify: grep for "packet.ai" leaks, optionally run `pnpm build`

### Export Commands

```bash
# Dry run — export to a directory for review (fast, skips build)
npx tsx scripts/export-oss.ts --output ../packet-oss --skip-build

# Full verification — export + install + build (slow, catches import breaks)
npx tsx scripts/export-oss.ts --output ../packet-oss

# Strict mode — fails on any "packet.ai" references
npx tsx scripts/export-oss.ts --output ../packet-oss --strict

# Push to public repo — full verify + git push (implies --strict)
npx tsx scripts/export-oss.ts --push
```

**Important**: `git archive HEAD` only exports **committed** code. Uncommitted changes won't appear in the export. Always commit first.

### Directory Structure

```
oss/                          # OSS overlay directory (never exported itself)
  README.md                   # OSS-specific README (replaces Pro README)
  CONTRIBUTING.md             # Contributor guide
  LICENSE                     # MIT license
  SECURITY.md                 # Security policy
  .env.example                # OSS environment template
  docker-compose.yml          # Docker deployment config
  install.sh                  # One-line bare metal installer
  upgrade.sh                  # Upgrade script (git pull + migrate + rebuild)
  uninstall.sh                # Clean removal script
  cli/                        # OSS CLI tool (gpu-cloud command)
    src/
      commands/               # login, gpus, launch, ps, ssh, terminate, logs, setup
    package.json
    tsconfig.json

.oss-manifest.yaml            # Export configuration
  exclude:                    # ~190 glob patterns for premium files to remove
  overlay:                    # 10 mappings from oss/ → output
  overrides:                  # package.json and env var patches
```

### Edition System

Two env vars control edition detection at build time:

- `NEXT_PUBLIC_EDITION=oss` (client-side, set in OSS `.env.example`)
- `EDITION=oss` (server-side fallback)

Code uses guards from `src/lib/edition.ts`:

```typescript
import { isOSS, isPro, hasPremiumFeature } from "@/lib/edition";

if (isPro()) { /* show Token Factory tab */ }
if (hasPremiumFeature("tenant")) { /* show multi-tenancy */ }
```

In the OSS build, premium source files are **physically removed** by the export pipeline. The edition guards are a runtime safety net for shared code that conditionally references premium features.

### Branding System

All user-visible brand strings come from `src/lib/branding.ts`:

```typescript
import { getBrandName, getAppUrl, getDashboardUrl, getSupportEmail } from "@/lib/branding";
```

- Pro defaults: "Packet.ai", "https://packet.ai", etc.
- OSS defaults: "GPU Cloud", "http://localhost:3000", etc.
- All values are overridable via env vars (`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL`, etc.)

**Rule**: Never hardcode "Packet.ai" or "packet.ai" in shared code. Use branding functions instead. The export script verifies this and will block `--push` if leaks are found.

### Where to Make Changes

| Scenario | Where to Edit |
|---|---|
| Bug in shared code (components, lib, API routes) | `src/` in this (Pro) repo |
| Branding leak ("Packet.ai" visible in OSS) | `src/` — replace with `getBrandName()` / `getAppUrl()` etc. |
| OSS-only content (README, install scripts, CLI) | `oss/` overlay directory |
| File incorrectly included/excluded in OSS | `.oss-manifest.yaml` — add/remove exclusion pattern |
| Import error in OSS build (excluded file still imported) | Fix in `src/` — use dynamic import with edition guard, or create a stub in `oss/` as an overlay |
| New premium feature | Add exclusion patterns to `.oss-manifest.yaml`, gate shared references with `hasPremiumFeature()` |

**Never edit the exported OSS output directly.** It gets wiped and regenerated. Treat it like `.next/` — a build artifact.

### Debugging the OSS Edition Locally

**Option A — Quick edition toggle** (fast, good for testing feature flags and branding):

```bash
NEXT_PUBLIC_EDITION=oss pnpm dev
```

This flips `isOSS()` → true so all edition guards activate. All files are still physically present though, so it **won't catch missing imports** from excluded files.

**Option B — Full export test** (slow, catches everything an OSS user would hit):

```bash
npx tsx scripts/export-oss.ts --output ../packet-dev/packet-oss --skip-build
cd ../packet-dev/packet-oss
pnpm install
pnpm dev
```

Use Option A for day-to-day development. Use Option B before any OSS release to surface broken imports.

### End-User Installation Methods

The OSS repo ships three installation paths:

**1. Manual (developers)**:
```bash
git clone <repo-url> && cd gpu-cloud-dashboard
pnpm install
cp .env.example .env.local    # Edit DATABASE_URL at minimum
npx prisma db push
pnpm dev                      # or: pnpm build && pnpm start
```

**2. Bare metal installer** (`install.sh`):
```bash
curl -fsSL <url>/install.sh | bash
# or: bash install.sh --docker
```
Creates a system user, MariaDB database, installs deps, builds, creates a systemd service, and optionally configures nginx reverse proxy. Installs to `/opt/gpu-cloud-dashboard/`.

**3. Docker** (`docker-compose.yml`):
```bash
cp .env.example .env.local && docker-compose up -d
```
Runs the app + MariaDB. **Note**: Dockerfile is still needed (TODO).

### Upgrade & Uninstall (End Users)

**Upgrade** (`upgrade.sh`): Backs up the database, stops the service, git pulls, installs deps, runs Prisma migrations, rebuilds, and restarts.
```bash
sudo bash upgrade.sh                    # Upgrade to latest main
sudo bash upgrade.sh --branch v1.2.0    # Upgrade to specific tag
```

**Uninstall** (`uninstall.sh`): Interactive removal of service, database, nginx config, install directory, and system user.
```bash
sudo bash uninstall.sh           # Interactive prompts
sudo bash uninstall.sh --yes     # Remove everything
sudo bash uninstall.sh --keep-db # Keep database intact
```

### Maintaining the Manifest

When adding new premium features:

1. Create your feature files in `src/` as normal
2. Add glob exclusion patterns to `.oss-manifest.yaml` under the appropriate section
3. If shared code references the feature, gate it: `if (hasPremiumFeature("my-feature")) { ... }`
4. Run `npx tsx scripts/export-oss.ts --output /tmp/oss-test --strict` to verify
5. Check for import breaks: `cd /tmp/oss-test && pnpm install && pnpm build`

The export script has an **allowlist** of files that may legitimately contain "packet.ai" (Pro-edition defaults with env var fallbacks): `branding.ts`, `auth/admin.ts`, `zammad/client.ts`, `email/utils.ts`.

### OSS Release Workflow

1. Ensure all changes are committed on the Pro repo
2. Run full export with build verification: `npx tsx scripts/export-oss.ts --output ../packet-oss`
3. Review diff in the OSS output: `cd ../packet-oss && git diff`
4. Push: `npx tsx scripts/export-oss.ts --push` (pushes to `git@github.com:discod/packet-oss.git`)

### Known Gaps / TODOs

- **Dockerfile**: `docker-compose.yml` references `build: .` but no Dockerfile exists yet. Need a multi-stage Node build in `oss/Dockerfile`.
- **Tenant import breaks**: Some files import from `src/lib/tenant/` which is excluded. Needs stubs or dynamic imports guarded by `isPro()`.
- **OSS build verification**: A full `pnpm build` of the exported output has not been tested end-to-end yet. Must be done before first public release.
