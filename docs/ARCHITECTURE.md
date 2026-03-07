# Technical Architecture

Technical reference for the Packet-OSS GPU cloud platform, powered by [hosted.ai](https://hosted.ai).

> **GPU Backend:** All GPU infrastructure in this platform is managed through the [hosted.ai](https://hosted.ai) API. Pod deployment, orchestration, scaling, billing, and monitoring all depend on hosted.ai. A hosted.ai account with API credentials is required.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [Request Flow](#request-flow)
4. [Source Layout](#source-layout)
5. [Authentication](#authentication)
6. [Database Schema](#database-schema)
7. [Stripe Billing Integration](#stripe-billing-integration)
8. [GPU Backend (hosted.ai)](#gpu-backend-hostedai)
9. [Inference API (LLM)](#inference-api-llm)
10. [Email System](#email-system)
12. [SSH Terminal](#ssh-terminal)
13. [Cron Jobs](#cron-jobs)
14. [Platform Settings](#platform-settings)
15. [Admin Panel Architecture](#admin-panel-architecture)
16. [Marketing Pages](#marketing-pages)
17. [API Reference](#api-reference)

---

## System Overview

Packet-OSS is a full-featured GPU-as-a-Service platform. Customers deploy GPU instances, run LLM inference, and generate images through a web dashboard. The platform handles billing (prepaid wallets or monthly subscriptions via Stripe), GPU pod lifecycle management (via hosted.ai API), and a complete admin panel for operations.

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / CLI                         │
├──────────┬──────────┬───────────┬──────────┬────────────────┤
│ Dashboard│  Admin   │ Terminal  │Token API │  Marketing     │
│ (React)  │  (SPA)   │ (xterm)  │(OpenAI)  │  (SSR)         │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬─────────┘
     │          │          │          │            │
┌────┴──────────┴──────────┴──────────┴────────────┴──────────┐
│                    Next.js App Router                         │
│                    src/middleware.ts                          │
├─────────────────────────────────────────────────────────────┤
│                    API Routes (src/app/api/)                  │
├──────────┬──────────┬───────────┬──────────┬────────────────┤
│ Admin API│ Customer │ Webhooks  │  v1 API  │  Cron Jobs     │
│          │   API    │ (Stripe)  │(Inference)│               │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬─────────┘
     │          │          │          │            │
┌────┴──────────┴──────────┴──────────┴────────────┴──────────┐
│                Business Logic Layer (src/lib/)                │
├──────────┬──────────┬───────────┬──────────┬────────────────┤
│  Auth    │  Stripe  │ hosted.ai │  Token   │   Email        │
│  (JWT)   │  Wallet  │   Client  │ Factory  │  (Emailit)     │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴──────┬─────────┘
     │          │          │          │            │
┌────┴──────────┴──────────┴──────────┴────────────┴──────────┐
│   Prisma ORM                                                 │
│   SQLite (data/packet.db)                                    │
└─────────────────────────────────────────────────────────────┘

Separate Process:
┌──────────────────────────┐
│  SSH WebSocket Server    │
│  (ws://host:3002)        │
│  src/server/ssh-ws.ts    │
└──────────────────────────┘
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router, React 19) |
| Language | TypeScript (strict mode) |
| Database | SQLite via Prisma ORM |
| Styling | Tailwind CSS 4 |
| Payments | Stripe (subscriptions, charges, wallets) |
| GPU Backend | hosted.ai REST API |
| Auth | JWT (jsonwebtoken) - no NextAuth |
| Email | Emailit API |
| SSH Terminal | xterm.js + ws + ssh2 |
| Process Manager | PM2 |
| Testing | Vitest (unit) + Playwright (E2E) |
| Validation | Zod |

---

## Request Flow

### Middleware

`src/middleware.ts` intercepts all requests:

1. **Non-POST requests** - Pass through unchanged
2. **POST to `/api/*` or `/_next/*`** - Pass through (API routes and Next.js internals)
3. **POST to anything else** - Return 405 Method Not Allowed

This exists because the app uses zero server actions. Bots that POST to page routes would trigger Next.js server action errors without this guard.

### Route Resolution

```
GET /dashboard       → src/app/dashboard/page.tsx (customer dashboard)
GET /admin           → src/app/admin/page.tsx (admin SPA)
GET /admin?tab=pods  → admin SPA renders PodsTab component
POST /api/admin/pods → src/app/api/admin/pods/route.ts
POST /api/v1/chat/completions → LLM inference API
GET /                → src/app/(marketing)/page.tsx (landing page)
```

---

## Source Layout

```
src/
  app/
    (marketing)/          # Public marketing pages (grouped route)
    account/              # Customer account management
    admin/                # Admin panel SPA
      components/         # Admin tab components (30+)
      hooks/              # useAdminData, useAdminAction
      types.ts            # AdminTab type union
      login/              # Admin login + setup wizard
    api/
      admin/              # Admin API (40+ route groups)
      cron/               # Scheduled jobs
      v1/                 # OpenAI-compatible inference API
      webhooks/           # Stripe webhooks
    dashboard/            # Customer GPU dashboard
    terminal/             # Web SSH terminal
  components/             # Shared React components
  hooks/                  # Shared React hooks
  lib/
    auth/                 # JWT auth modules (admin, customer, provider, investor)
    email/                # Email client + templates
    hostedai/             # hosted.ai API client (10 modules)
    voucher/              # Voucher system
    referral/             # Referral system
    zammad/               # Support ticket integration
    api/                  # Inference API helpers
    settings.ts           # Platform settings (DB-backed, encrypted)
    stripe.ts             # Stripe singleton
    wallet.ts             # Wallet operations
    prisma.ts             # Prisma client singleton
    cron-auth.ts          # Cron job authentication
  middleware.ts           # POST request blocking
  server/
    ssh-websocket.ts      # Standalone SSH WebSocket server
tests/
  unit/                   # Vitest unit tests
  e2e/                    # Playwright E2E tests
prisma/
  schema.prisma           # Database schema (50+ models)
data/
  admins.json             # Admin accounts (flat file)
  investors.json          # Investor configuration
  packet.db               # SQLite database (created on first run)
```

---

## Authentication

Three independent auth systems, all JWT-based.

### Admin Authentication

**Files:** `src/lib/auth/admin.ts`, `src/app/api/admin/auth/route.ts`

- Admin accounts stored in `data/admins.json` (flat file, not DB)
- Passwords hashed with `scryptSync` (Node.js crypto, no bcrypt dependency)
- Hash format: `<16-byte-salt-hex>:<64-byte-hash-hex>`
- Two JWT token types:
  - `admin-login` - 15 minute expiry, issued after password verification, used to pass 2FA gate
  - `admin-session` - 4 hour expiry, issued after 2FA verification, stored in `admin_session` cookie
- Secret: `ADMIN_JWT_SECRET` (auto-generated on first boot if not set)
- Token verification also checks the email still exists in `admins.json` (revocation by removal)
- Optional domain restriction via `ADMIN_EMAIL_DOMAINS` env var

### Customer Authentication

**File:** `src/lib/auth/customer.ts`

- Secret: `CUSTOMER_JWT_SECRET` (auto-generated on first boot)
- Token payload: `{ email, customerId, type: "customer-dashboard" }`
- Default expiry: 1 hour (configurable per customer via `CustomerSettings.sessionTimeoutHours`)
- Admin "Login As" bypass: `generateAdminBypassToken()` sets `skipTwoFactor: true`
- Drip campaign unsubscribe tokens: `drip-unsubscribe` type, 90-day expiry

### Cron Authentication

**File:** `src/lib/cron-auth.ts`

- `CRON_SECRET` env var (fail-closed: returns 500 if not set)
- Accepts: `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`
- Uses `crypto.timingSafeEqual` to prevent timing attacks

### Inference API Keys

**File:** `src/lib/api/auth.ts`

- `ApiKey` table stores `keyPrefix` + `keyHash` (SHA-256)
- Used as `Authorization: Bearer pk_<key>` for `/api/v1/` endpoints
- Per-key rate limit (`rateLimitRpm`)

### Provider & Investor Auth

Separate JWT modules in `src/lib/auth/provider.ts` and `src/lib/auth/investor.ts` for their respective portals.

---

## Database Schema

**Engine:** SQLite via Prisma ORM. All monetary values stored in **cents** as integers.

### Core Model Groups

**Customers & Users**
- `CustomerCache` - Denormalized Stripe customer data (balance, email, team ID, active pods)
- `CustomerLifecycle` - Full attribution + lifecycle milestones (signup, first deposit, first GPU, churn, LTV)
- `CustomerSettings` - Per-customer preferences
- `TeamMember` - Multi-user team membership
- `SSHKey` - Customer SSH public keys
- `ApiKey` - Inference API keys
- `BudgetSettings` / `BudgetAlert` - Spending limits and alerts

**GPU Pods**
- `PodMetadata` - Local metadata for hosted.ai pods (display name, billing type, hourly rate, startup script)
- `PodSnapshot` - Pod state snapshots/templates
- `PodMetricsHistory` - Historical TFLOPS/VRAM/cost per pod
- `GpuHardwareMetrics` - Real-time GPU telemetry (utilization, temp, power, memory)
- `PodUptimeDay` - Daily heartbeat counters
- `SubscriptionLineage` - Pod re-creation history chain

**Products & Pricing**
- `GpuProduct` - GPU product catalog with pricing and pool mappings
- `GpuApp` / `InstalledApp` - One-click application catalog

**Billing**
- `WalletTransaction` - Local ledger of all charges/credits
- `ProcessedStripeEvent` - Idempotency table for Stripe webhooks

**Inference**
- `InferenceServer` - vLLM server registry
- `InferenceModel` - Model catalog with pricing
- `InferenceUsage` - Per-request billing records
- `InferenceBatchJob` / `InferenceRequest` - Batch processing
- `LoraAdapter` - Customer LoRA fine-tunes
- `InferencePricingConfig` - Global pricing configuration
- `ImageModel` / `ImageGeneration` - Image generation models and jobs

**Providers**
- `ServiceProvider` - GPU provider companies
- `ProviderNode` - Individual GPU servers
- `ProviderPricingTier` - Pricing tiers
- `ProviderNodeUsage` - Revenue attribution per node
- `ProviderPayout` - Payout records
- `AllowedGpuType` - Admin-approved GPU types

**Infrastructure**
- `PoolSettingsDefaults` / `PoolSettingsOverride` - hosted.ai pool configuration
- `SpheronDeployment` / `SpheronVolume` - Spheron integrations

**Marketing & Admin**
- `PageView` - Anonymous page view tracking with UTM
- `AdminStatsSnapshot` - Daily KPI snapshots
- `DripSequence` / `DripStep` / `DripEnrollment` - Drip campaigns
- `EmailTemplate` - Editable email templates
- `CampaignBanner` - Site-wide banners
- `SystemSetting` - Platform settings (key-value, optional encryption)

### Key Relationships

```
Stripe Customer (cus_xxx)
  ├── PodMetadata (via stripeCustomerId)
  │     └── WalletTransaction (billing ledger)
  ├── ApiKey (inference API access)
  ├── InferenceUsage (token billing)
  └── CustomerLifecycle (attribution + LTV)

ServiceProvider
  └── ProviderNode
        └── InferenceServer
              └── InferenceUsage (server attribution)

GpuProduct
  └── maps pool IDs → pricing tiers

InferenceModel
  ├── LoraAdapter (fine-tuned variants)
  └── InferenceBatchJob → InferenceRequest
```

---

## Stripe Billing Integration

**Files:** `src/lib/stripe.ts`, `src/lib/wallet.ts`

Stripe is optional - all billing features gracefully degrade when `STRIPE_SECRET_KEY` is not configured.

### Prepaid Wallet System

Uses Stripe's customer balance (not Cash Balance API):
- Negative balance = customer has credit
- `getWalletBalance()` retrieves balance and flips sign (positive = credit available)
- `fundWallet()` creates PaymentIntent, charges card, then creates negative balance transaction
- `deductUsage()` creates positive balance transaction with two-layer deduplication:
  1. Balance guard: refuses debit if insufficient credit
  2. Dedup check: scans recent transactions by `syncCycleId` metadata within 5 minutes

### Webhook Handler

**File:** `src/app/api/webhooks/stripe/route.ts`

Atomic event claiming via `ProcessedStripeEvent` table (unique constraint = idempotency).

Events handled:
- `checkout.session.completed` - Creates hosted.ai team, sends welcome email, enrolls in drip campaign
- `customer.subscription.*` - Subscription lifecycle management
- `payment_intent.succeeded` - Wallet top-up confirmation

### Billing Types

| Type | How It Works | Rate Source |
|------|-------------|-------------|
| Hourly | Prepaid wallet, deducted by cron | `GpuProduct.pricePerHourCents` or `PodMetadata.hourlyRateCents` |
| Monthly | Stripe subscription | `GpuProduct.stripePriceId` |
| Token inference | Per-token from wallet | `InferencePricingConfig` rates |

---

## GPU Backend (hosted.ai)

**Files:** `src/lib/hostedai/` (10 modules)

### Client Layer

`client.ts` provides `hostedaiRequest<T>(method, endpoint, data?, timeoutMs?)`:
- Authenticated via `X-API-Key` header
- Timeouts: 15s GET, 30s POST
- In-memory cache with 30-second TTL

### Modules

| Module | Key Functions |
|--------|--------------|
| `teams.ts` | `createTeam`, `onboardUser`, `suspendTeam`, `terminateTeam` |
| `pools.ts` | `subscribeToPool`, `unsubscribeFromPool`, `podAction`, shared volumes |
| `instances.ts` | `createInstance`, `startInstance`, `stopInstance`, `deleteInstance`, VNC |
| `billing.ts` | `getTeamBillingSummary`, `getTeamUsageSinceLast` |
| `metrics.ts` | `getGPUaaSMetrics`, `getGPUaaSMetricsGraph` |
| `services.ts` | `exposeService`, port management |
| `policies.ts` | Resource policy management |

### Pod Lifecycle

1. Customer deploys → `subscribeToPool()` or `createInstance()` on hosted.ai
2. hosted.ai returns subscription/instance ID → stored in `PodMetadata`
3. Cron polls hosted.ai billing → `deductUsage()` → `WalletTransaction`
4. On termination: auto-preserve snapshot, send failure alert

---

## Inference API (LLM)

OpenAI-compatible API at `/api/v1/` routing requests to a fleet of vLLM servers.

### Request Flow

```
Client (OpenAI SDK compatible)
  │ Authorization: Bearer pk_<apikey>
  ▼
/api/v1/chat/completions
  │
  ▼
inference/index.ts
  │ getInferenceServers() ← Prisma: status in [ready, busy]
  │ scrapeVllmMetrics()   ← HTTP GET /metrics from vLLM
  │ selectBestServer()    ← routing score algorithm
  ▼
vLLM server (http://<ip>:<port>/v1/...)
  │
  ▼
Record InferenceUsage + deductUsage() from wallet
```

### Routing Score Algorithm

`calculateRoutingScore(metrics)`:
- Start at 100 points
- -10 per queued request (running + waiting)
- -50 x KV cache usage percent
- -30 if engine sleeping
- +10 x prefix cache hit rate
- Minimum: 0
- Server unhealthy if KV cache >= 99% or waiting requests > 50

Cache TTL: 15 seconds in-process.

### Supported Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/chat/completions` | Chat completions (streaming supported) |
| `POST /api/v1/completions` | Text completions |
| `POST /api/v1/embeddings` | Text embeddings |
| `GET /api/v1/models` | List available models |
| `POST /api/v1/batches` | Create batch job |
| `GET /api/v1/batches/:id` | Get batch status |

### LoRA Fine-tuning

LoRA training is executed via SSH onto inference servers. `LoraAdapter` tracks training status (pending → training → ready/failed), hyperparameters, and adapter path.

---

## Email System

**Files:** `src/lib/email/`

### Transport

- Provider: Emailit API (`https://api.emailit.com/v1/emails`)
- Retry: 4 retries with linear backoff (1s, 2s, 3s, 4s) on 429 rate limit
- Admin BCC: Optional copy with 5s delay to avoid rate limit
- Graceful degradation: Logs warning when email not configured

### Templates

All templates in `src/lib/email/templates/` are TypeScript files generating HTML with inline styles:

| Template | Purpose |
|----------|---------|
| `welcome.ts` | New customer welcome + magic login link |
| `drip.ts` | Drip campaign emails |
| `midnight-status.ts` | Daily admin KPI summary |
| `quotes.ts` | Sales quote emails |
| `alerts.ts` / `budget.ts` | Budget alert notifications |
| `gpu-events.ts` / `pod-failure.ts` | Pod lifecycle events |
| `support.ts` | Support ticket replies |
| `provider/` | Provider notifications |

---

## SSH Terminal

**File:** `src/server/ssh-websocket.ts`

Standalone Node.js process (not a Next.js route), runs under PM2.

- Port: `SSH_WS_PORT` env var (default: 3002)
- Flow: Browser → WebSocket → JWT verification → ssh2 Client → GPU pod
- Frontend: `src/app/terminal/` renders xterm.js terminal
- Kills stale processes on startup via `fuser -k`
- Error-resilient: `uncaughtException` handler prevents crashes

---

## Cron Jobs

HTTP-triggered endpoints authenticated via `CRON_SECRET` header.

| Route | Purpose |
|-------|---------|
| `/api/cron/midnight-status-email` | Daily KPI email to admin |
| `/api/cron/process-batches` | Process queued batch inference jobs |
| Billing sync crons | Poll hosted.ai usage → deduct from wallets |
| Drip campaign cron | Advance drip enrollments, send emails |

All cron routes support both `GET` (manual trigger) and `POST` (automated).

Authentication: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.

---

## Platform Settings

**File:** `src/lib/settings.ts`

Central configuration module that reads from DB with fallback to environment variables.

### How It Works

1. `getSetting(key)` - Checks in-memory cache → DB (`SystemSetting` table) → `process.env[key]`
2. `setSetting(key, value, encrypted?)` - Writes to DB, clears cache
3. `isServiceConfigured(service)` - Checks all required keys for a service are present
4. Cache TTL: 5 minutes

### Encryption

Sensitive values (API keys, secrets) are encrypted with AES-256-GCM:
- Key derived from `ADMIN_JWT_SECRET`
- Stored as `iv:authTag:ciphertext` in the `value` field
- `encrypted: true` flag in `SystemSetting` row

### Auto-Generated Secrets

On first boot, `ensureJwtSecrets()` generates and stores:
- `ADMIN_JWT_SECRET` (64-char hex)
- `CUSTOMER_JWT_SECRET` (64-char hex)
- `CRON_SECRET` (64-char hex)

---

## Admin Panel Architecture

**Path:** `src/app/admin/`

### Tab-Based SPA

The admin panel is a single-page application with `?tab=` URL routing:

1. `AdminTab` type union in `types.ts` defines all valid tabs (44 tabs)
2. `VALID_ADMIN_TABS` array in `useAdminData.ts` controls URL routing
3. Tab components in `components/` directory
4. `AdminDashboard.tsx` renders the active tab component
5. `AdminSidebar.tsx` provides navigation grouped into 5 sections

### Adding a New Admin Tab

1. Add to `AdminTab` type in `src/app/admin/types.ts`
2. Add to `VALID_ADMIN_TABS` in `src/app/admin/hooks/useAdminData.ts`
3. Create component in `src/app/admin/components/`
4. Export from `src/app/admin/components/index.ts`
5. Add to sidebar in `AdminSidebar.tsx`
6. Add label in `AdminDashboard.tsx` `getTabLabel()`
7. Add render case in `AdminDashboard.tsx`
8. Create API route at `src/app/api/admin/[tabname]/route.ts`

### Dashboard KPIs

The header displays 5 live metrics:
- Total Customers
- Active Pods
- MRR (Monthly Recurring Revenue)
- New This Week
- Revenue This Week

All with delta-from-yesterday indicators.

---

## Marketing Pages

**Route group:** `src/app/(marketing)/`

### Page Categories

| Category | Examples |
|----------|---------|
| Product pages | `/features`, `/technology`, `/use-cases`, `/for-providers` |
| GPU pages | `/gpu/b200`, `/gpu/h200`, `/gpu/rtx-6000`, `/blackwell` |
| Comparison pages | `/vs/vast-ai`, `/vs/lambda-labs`, `/vs/coreweave`, `/vs/runpod` |
| Product features | `/clusters`, `/game` |
| Legal | `/privacy`, `/terms`, `/sla` |
| Blog | `/blog` with static posts |
| Docs | `/docs/getting-started`, `/docs/ssh`, `/docs/billing`, etc. |

All marketing pages share a common layout (`layout.tsx`) with navigation and footer.

---

## API Reference

### Public API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v1/chat/completions` | POST | OpenAI-compatible chat completions |
| `/api/v1/completions` | POST | Text completions |
| `/api/v1/embeddings` | POST | Text embeddings |
| `/api/v1/models` | GET | List available models |
| `/api/v1/batches` | POST/GET | Batch job management |
| `/api/products` | GET | Public GPU product catalog |
| `/api/quotes/request` | POST | Request a sales quote |
| `/api/contact` | POST | Contact form submission |

### Admin API Routes

All routes under `/api/admin/` require `admin_session` JWT cookie.

| Route Group | Purpose |
|-------------|---------|
| `/api/admin/setup` | First-time setup wizard |
| `/api/admin/auth` | Admin authentication |
| `/api/admin/platform-settings` | Platform configuration |
| `/api/admin/customers` | Customer management |
| `/api/admin/pods` | Pod management |
| `/api/admin/gpu-products` | Product catalog CRUD |
| `/api/admin/inference` | Inference server management |
| `/api/admin/providers` | Provider management |
| `/api/admin/investors` | Investor management |
| `/api/admin/quotes` | Quote management |
| `/api/admin/stats` | Dashboard statistics |
| ... | 40+ route groups total |

### Webhook Routes

| Route | Purpose |
|-------|---------|
| `/api/webhooks/stripe` | Stripe event processing |

### Cron Routes

All require `CRON_SECRET` authentication.

| Route | Purpose |
|-------|---------|
| `/api/cron/midnight-status-email` | Daily KPI email |
| `/api/cron/process-batches` | Batch job processing |
