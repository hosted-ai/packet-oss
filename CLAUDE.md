# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GPU Cloud Dashboard is an open-source GPU cloud platform dashboard built with Next.js 16. It manages GPU pod rentals via a hosted.ai backend, optional Stripe billing, and an admin panel for platform management. The database is MariaDB/MySQL via Prisma.

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

## Architecture

### Stack

- **Framework**: Next.js 16 (App Router, React 19, Tailwind CSS 4)
- **Database**: MariaDB/MySQL with Prisma ORM (`prisma/schema.prisma`)
- **Payments**: Stripe (optional — platform works without it)
- **GPU Infrastructure**: hosted.ai API for pod management
- **Validation**: Zod
- **Auth**: JWT tokens (jsonwebtoken) — no NextAuth

### Source Layout

```
src/
  app/                  # Next.js App Router
    account/            # Customer account page
    admin/              # Admin panel (SPA with tab routing via ?tab=)
      login/            # Admin login page (password-based)
      setup/            # Admin invite setup page (set password via invite token)
      verify/           # Token verification + 2FA input
    api/                # API routes
      admin/            # Admin API endpoints
        auth/           # Login + invite setup endpoints
        security-health/# Security health check
        login-log/      # Login audit log
        platform-settings/ # DB-backed platform configuration
      cron/             # Cron job endpoints
      webhooks/         # Stripe webhook handlers
    dashboard/          # Customer dashboard
    terminal/           # Web SSH terminal
  components/           # Shared React components
  hooks/                # Shared React hooks
  lib/                  # Server-side business logic
    auth/               # Admin auth, 2FA, invite tokens, login audit
    email/              # Email templates (HTML inline-styled)
    settings.ts         # DB-backed platform settings (SystemSetting table)
    hostedai/           # hosted.ai API client
  middleware.ts         # Blocks bogus POST to non-API routes
tests/                  # Vitest unit/integration + Playwright E2E
prisma/schema.prisma    # Database schema
data/                   # File-based state (admins, secrets, invite tokens)
```

### Authentication

Password-based admin login with optional TOTP 2FA. All state managed via JWT tokens stored in `admin_session` cookie.

#### Login Flow

```
First Run (no admins exist):
  /admin/login → "setup" mode → email + password + confirm → bootstrap first admin → session

Normal Login:
  /admin/login → email + password
    → if 2FA enabled: pre-auth token → /admin/verify → TOTP code → session
    → if no 2FA: session directly

Invited Admin (new admin added via panel):
  /admin/setup?invite=<token> → set password → session
```

#### Key Auth Files

| File | Purpose |
|------|---------|
| `src/lib/auth/admin.ts` | Admin list (JSON file `data/admins.json`), password hashing (scrypt), JWT tokens |
| `src/lib/auth/two-factor.ts` | TOTP 2FA setup, verification, backup codes (DB-backed) |
| `src/lib/auth/invite-tokens.ts` | One-time invite tokens for admin setup (file-based, 24h expiry) |
| `src/lib/auth/login-log.ts` | Audit log for login attempts (DB-backed `AdminLoginLog` table) |
| `src/lib/auth/secrets.ts` | Auto-generates JWT secrets on first run (`data/secrets.json`) |
| `src/app/api/admin/auth/route.ts` | Main login endpoint (GET: mode detection, POST: password verify + 2FA) |
| `src/app/api/admin/auth/setup/route.ts` | Invite token claim + password setup |

#### Admin Invite Flow

When adding a new admin via the admin panel:
- **If email (SMTP) is configured**: invite email sent with setup link
- **If no email configured**: admin panel shows a copyable setup URL to share manually

The setup URL points to `/admin/setup?invite=<token>`. The token is single-use, expires in 24 hours, and is stored in `data/invite-tokens.json`.

#### 2FA Recovery

- Admin uses backup codes (8 codes generated during TOTP setup)
- Another admin resets their 2FA from the Admins tab (requires `PIN_RESET_ALLOWED_EMAILS` env var)
- Last resort (sole admin, no backup codes): delete row from `two_factor_auth` DB table directly

#### Security Features

- **Login audit log**: Every login attempt recorded in `AdminLoginLog` table (email, success/fail, IP, user-agent). Viewable in admin Activity tab.
- **Security health badge**: Colored dot in admin sidebar — green (3-4/4), yellow (2/4), red (0-1/4). Score based on: password set, 2FA enabled, email configured, zero recent failed logins.
- **Rate limiting**: 5 login attempts per 5 minutes per IP.
- **Invite token security**: Constant-time comparison, single-use, 24h expiry.

### Platform Settings

Self-hosted configuration is managed through the admin Platform Settings tab (`/admin?tab=platform-settings`), which stores values in the `SystemSetting` DB table with AES-256-GCM encryption for sensitive keys.

Services that can be configured:
- **GPU Backend** (hosted.ai): API URL + key
- **Stripe Billing**: Secret key, publishable key, webhook secret
- **Email (SMTP)**: Host, port, username, password, admin BCC
- **Support (Zammad)**: API URL + token

Settings are resolved with fallback: DB → `process.env`. Use `getSetting(key)` from `src/lib/settings.ts`.

#### Capability Gating

Admin tabs show informational banners when their required service is not configured. Tabs are never disabled — banners link to Platform Settings. Uses `isServiceConfigured()` from `src/lib/settings.ts`.

### Branding

All user-visible brand strings come from `src/lib/branding.ts` and are overridable via env vars or Platform Settings:

- `NEXT_PUBLIC_BRAND_NAME` (default: "GPU Cloud")
- `NEXT_PUBLIC_APP_URL` (default: "http://localhost:3000")
- `SUPPORT_EMAIL`, `NEXT_PUBLIC_LOGO_URL`, color theme vars

### Admin Panel Tab System

The admin panel is a single-page app at `/admin` with tab-based routing via `?tab=` query param. When adding a new tab:

1. Add to `AdminTab` type in `src/app/admin/types.ts`
2. Add to `VALID_ADMIN_TABS` array in `src/app/admin/hooks/useAdminData.ts`
3. Create tab component in `src/app/admin/components/`
4. Export from `src/app/admin/components/index.ts`
5. Add to sidebar in `AdminSidebar.tsx`
6. Add label in `AdminDashboard.tsx` `getTabLabel()`
7. Add render case in `AdminDashboard.tsx`
8. Create API route at `src/app/api/admin/[tabname]/route.ts` if needed

### Email System

HTML email templates with inline styles in `src/lib/email/templates/`. Uses SMTP via nodemailer for sending (configurable via Platform Settings). Email is **optional** — the platform works without it, using invite URLs instead of invite emails for admin setup.

Email templates are admin-customizable via the Email Templates tab. Code-defined defaults live in `src/lib/email/template-defaults.ts`. The `loadTemplate()` function checks for admin overrides in DB first, falling back to code defaults.

### Middleware

`src/middleware.ts` blocks all POST requests to non-API routes (returns 405). This exists because no server actions are used.

## Key Conventions

- Amounts are stored in **cents** (integer) throughout the codebase.
- Stripe customer `balance` is negative for credits (use `Math.abs(Math.min(0, balance))`).
- The hosted.ai team ID is stored in Stripe customer `metadata.team_id`.
- Pod status values from hosted.ai: `"running"`, `"active"`, `"subscribed"`, `"stopped"`, etc.
- Cron routes support both POST and GET (GET calls POST for manual testing).
- Admin data is file-based (`data/` directory) to work without DB during first-run bootstrap.
- Platform settings resolve: DB → env var fallback.

## Important Rules

- Never deploy incomplete features. All linked pages must exist before pushing.
- Always run `pnpm build` to verify before deploying.
- Environment variables go in `.env.local` (never committed). Check `.env.example` for required vars.
- **Bug fix workflow**: When a bug is reported, start by writing a test that reproduces the bug, then fix it.

## File-Based State (`data/` directory)

The `data/` directory stores state that needs to work before the database is initialized:

| File | Purpose |
|------|---------|
| `data/admins.json` | Admin list with password hashes |
| `data/secrets.json` | Auto-generated JWT secrets (created on first run) |
| `data/invite-tokens.json` | Pending admin invite tokens (24h expiry, single-use) |

This directory is created automatically. Back it up alongside your database.

## Installation

Two installation methods are supported:

1. **Bare metal**: `curl -fsSL https://raw.githubusercontent.com/hosted-ai/packet-oss/main/install.sh | sudo bash` (creates systemd service at `/opt/packet-oss/`)
2. **Manual**: `git clone` → `pnpm install` → configure `.env.local` → `npx prisma db push` → `pnpm dev`

See README.md for detailed instructions.

## Post-Install Reconfiguration

`reconfigure.sh` handles all day-2 configuration changes:

```bash
sudo bash reconfigure.sh                        # Interactive menu
sudo bash reconfigure.sh --show                 # Show current config
sudo bash reconfigure.sh --check                # Health diagnostics
sudo bash reconfigure.sh --domain new.example.com  # Change domain
sudo bash reconfigure.sh --port 3001            # Change app port
sudo bash reconfigure.sh --hai-url http://x:8055   # Change HAI URL
sudo bash reconfigure.sh --ssl-on               # Enable SSL
sudo bash reconfigure.sh --ssl-off              # Disable SSL
sudo bash reconfigure.sh --ssl-renew            # Force cert renewal
sudo bash reconfigure.sh --dry-run --domain x   # Preview changes
```

The script updates `.env.local`, Apache vhost, systemd service, and SSL certificates as needed. Backups are created before any change. Domain changes require a rebuild (`NEXT_PUBLIC_APP_URL` is a build-time variable).
