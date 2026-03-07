# Packet-OSS - Open Source GPU Cloud Platform

**Built on [hosted.ai](https://hosted.ai)** | Next.js 16 | Prisma/SQLite | Stripe

A full-featured GPU cloud platform dashboard powered by the **[hosted.ai](https://hosted.ai)** GPU infrastructure API. Fork and deploy to run your own GPU-as-a-Service business.

### Live Demo

See it in action at **[www.packet.ai](https://www.packet.ai)**

---

**This platform requires [hosted.ai](https://hosted.ai).** All GPU pod deployment, orchestration, scaling, monitoring, and billing runs through the hosted.ai API. You need a hosted.ai account and API credentials for the platform to function. Visit [hosted.ai](https://hosted.ai) to get access.

## Features

- **Customer Dashboard** - Deploy & manage GPU instances, SSH keys, team members, billing
- **Admin Panel** - 30+ tabs for managing customers, pods, products, pricing, providers, and more
- **Provider Portal** - GPU providers can manage nodes, pricing, and payouts
- **Investor Portal** - Revenue tracking and performance dashboards
- **Inference API** - OpenAI-compatible LLM inference API with vLLM orchestration
- **Stripe Billing** - Optional prepaid wallets, subscriptions, and payment processing
- **Web SSH Terminal** - Browser-based terminal access to GPU instances
- **Marketing Pages** - Landing page, GPU product pages, comparison pages, blog, docs
- **Two-Factor Auth** - TOTP-based 2FA for admin security
- **Referral & Voucher System** - Built-in referral codes and discount vouchers

## Prerequisites

- **[hosted.ai](https://hosted.ai) account** - Required for GPU pod management. All GPU deployment, orchestration, and monitoring runs through the hosted.ai API. You will need an API URL and API key from hosted.ai.
- **Node.js 18+** and **pnpm 8+**
- **Stripe account** (optional) - For customer billing, wallets, and subscriptions

## Quick Start

```bash
# 1. Clone and install
git clone <your-repo-url> && cd packet-oss
pnpm install

# 2. Create environment file
cp .env.example .env.local

# 3. Initialize the database
npx prisma db push

# 4. Start development server
pnpm dev

# 5. Set up your admin account
# Visit http://localhost:3000/admin
# Create your admin account with email + password
# Go to Platform Settings to configure your hosted.ai API keys
```

## Configuration

### Zero-Config Boot

The app boots and runs with just `DATABASE_URL` configured. All other settings can be configured through the admin panel at **Admin > Platform Settings**.

**Important:** While the app starts without any API keys, GPU features (pod deployment, management, monitoring) require a [hosted.ai](https://hosted.ai) API connection. Configure your hosted.ai credentials in Platform Settings after your first login.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite connection string (default: `file:./data/packet.db`) |
| `NEXT_PUBLIC_APP_URL` | No | Your app's public URL (default: `http://localhost:3000`) |
| `ADMIN_JWT_SECRET` | No | Auto-generated if not set |
| `STRIPE_SECRET_KEY` | No | Enables billing features |
| `HOSTEDAI_API_URL` | **Yes*** | hosted.ai API URL (required for GPU features) |
| `HOSTEDAI_API_KEY` | **Yes*** | hosted.ai API key (required for GPU features) |
| `EMAILIT_API_KEY` | No | Enables email notifications |

*hosted.ai credentials are required for GPU functionality but the app will boot without them. Configure via admin UI or .env file.

All optional variables can also be configured in the admin UI instead of .env files.

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: SQLite with Prisma ORM
- **Styling**: Tailwind CSS 4
- **Payments**: Stripe (optional)
- **GPU Backend**: [hosted.ai](https://hosted.ai) API (required)
- **Auth**: JWT (jsonwebtoken) with password + magic link login
- **Process Manager**: PM2

## Architecture

```
src/
  app/                    # Next.js App Router
    (marketing)/          # Public marketing pages
    account/              # Customer account
    admin/                # Admin panel (SPA, tab routing via ?tab=)
    api/                  # API routes
      admin/              # Admin API
      cron/               # Scheduled jobs
      v1/                 # OpenAI-compatible inference API
      webhooks/           # Stripe webhooks
    dashboard/            # Customer GPU dashboard
    terminal/             # Web SSH terminal
  components/             # Shared React components
  lib/                    # Server-side business logic
    auth/                 # JWT auth (admin + customer)
    email/                # Email templates
    hostedai/             # GPU infrastructure client
    settings.ts           # Platform settings (DB-backed)
  middleware.ts           # POST request blocking
prisma/schema.prisma      # Database schema
data/                     # JSON config files + SQLite DB
```

## Production Deployment

```bash
# Build for production
pnpm build

# Start with PM2
pm2 start ecosystem.config.cjs

# Or start directly
pnpm start
```

### Database

The app uses SQLite for simplicity. For production:

```bash
# Apply schema to fresh database
npx prisma db push

# Generate Prisma client after schema changes
npx prisma generate
```

## Development

```bash
pnpm dev              # Start dev server
pnpm build            # Production build
pnpm lint             # ESLint
pnpm test:unit        # Vitest tests
pnpm test:e2e         # Playwright E2E tests
npx tsc --noEmit      # Type check
```

## GPU Backend

This platform is built on the [hosted.ai](https://hosted.ai) GPU infrastructure API. All GPU pod lifecycle management - deployment, scaling, monitoring, billing, and orchestration - is handled through hosted.ai. You must have a hosted.ai account with API credentials to operate GPU features.

To get started with hosted.ai, visit [hosted.ai](https://hosted.ai).

## License

MIT
