# Admin Guide

Complete guide to administering your Packet-OSS GPU cloud platform.

> **This platform is powered by [hosted.ai](https://hosted.ai).** All GPU pod management, deployment, and orchestration requires a hosted.ai account with API credentials. Visit [hosted.ai](https://hosted.ai) to get started.

---

## Table of Contents

1. [First-Time Setup](#first-time-setup)
2. [Admin Login](#admin-login)
3. [Platform Settings](#platform-settings)
4. [Managing Customers](#managing-customers)
5. [Managing Administrators](#managing-administrators)
6. [GPU Pod Management](#gpu-pod-management)
7. [GPU Products & Pricing](#gpu-products--pricing)
8. [Pool & Node Management](#pool--node-management)
9. [Inference API (LLM)](#inference-api-llm)
10. [Provider Management](#provider-management)
12. [Investor Portal](#investor-portal)
13. [Billing & Wallets](#billing--wallets)
14. [Email & Drip Campaigns](#email--drip-campaigns)
15. [Marketing & Analytics](#marketing--analytics)
16. [Support Tickets](#support-tickets)
17. [Referrals & Vouchers](#referrals--vouchers)
18. [Two-Factor Authentication](#two-factor-authentication)
19. [Cron Jobs](#cron-jobs)
20. [Admin Sidebar Reference](#admin-sidebar-reference)

---

## First-Time Setup

When you first deploy Packet-OSS, no admin account exists. The setup wizard guides you through initial configuration.

### Step 1: Create Your Admin Account

1. Visit `http://your-domain/admin`
2. You'll see the **"Create Admin Account"** setup form
3. Enter your email address and choose a password (minimum 8 characters)
4. Click **"Create Admin Account"**
5. You're logged in immediately and redirected to Platform Settings

### Step 2: Configure Platform Settings

After creating your admin account, you'll land on the **Platform Settings** tab. Configure your integrations in this order:

1. **GPU Backend ([hosted.ai](https://hosted.ai))** - **Required for GPU features.** Enter your hosted.ai API URL and API key. Without this, no GPU pods can be deployed or managed. Get your credentials at [hosted.ai](https://hosted.ai).
2. **Stripe Billing** - Optional. Enter your Stripe secret key, publishable key, and webhook secret to enable billing.
3. **Email (Emailit)** - Optional. Enter your Emailit API key to enable email notifications and magic link login.
4. **Branding** - Set your platform name, logo URL, colors, and support email.
5. **Support (Zammad)** - Optional. For customer support ticket integration.
6. **CRM (Pipedrive)** - Optional. For sales pipeline tracking.

Each service shows a status indicator:
- **Green dot + "Connected"** - All required keys are configured
- **Grey dot + "Not configured"** - Missing required keys

### Step 3: Set Up Stripe Webhooks

If you configured Stripe, set up a webhook endpoint:

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://your-domain/api/webhooks/stripe`
3. Select events: `checkout.session.completed`, `customer.subscription.*`, `payment_intent.*`
4. Copy the webhook signing secret to Platform Settings > Stripe > Webhook Secret

### Step 4: Configure GPU Products

1. Go to the **Products** tab
2. Add GPU products with pricing, pool IDs (from hosted.ai), and billing type (hourly or monthly)
3. Set up landing page offerings in the **Landing Page** tab

---

## Admin Login

### Password Login

All admins can log in with their email and password at `/admin`.

### Magic Link Login

If the Emailit email service is configured, admins also have the option to receive a login link via email. Toggle between password and magic link on the login page.

### Two-Factor Authentication

Admins can enable TOTP-based 2FA for additional security. See [Two-Factor Authentication](#two-factor-authentication).

---

## Platform Settings

The **Platform Settings** tab (`?tab=platform-settings`) is where you configure all external service integrations. Settings are stored encrypted in the database and take precedence over environment variables.

### Service Groups

| Service | Keys | Purpose |
|---------|------|---------|
| **Branding** | Brand name, App URL, Logo URL, Primary color, Accent color, Support email | Platform identity |
| **GPU Backend** | API URL, API key | Required for all GPU features |
| **Stripe Billing** | Secret key, Publishable key, Webhook secret | Customer billing (optional) |
| **Email (Emailit)** | API key, Admin BCC email | Email notifications (optional) |
| **Support (Zammad)** | API URL, API token | Support ticket system (optional) |
| **CRM (Pipedrive)** | API token | Sales pipeline (optional) |

### Editing Settings

1. Click the pencil icon on any service card
2. Enter or update the values (sensitive keys use password inputs)
3. Click **Save** to apply
4. The status indicator updates immediately

### Environment Variables vs Admin Settings

Settings configured in the admin UI are stored in the database and take priority. You can also set values via environment variables in `.env.local` - the system checks the database first, then falls back to environment variables.

---

## Managing Customers

**Tab:** Customers (`?tab=customers`)

### Customer List

- Browse all customers with pagination
- Search by email or name
- View balance, active pods, team ID, and registration date

### Customer Actions

- **View Details** - Full customer profile with Stripe data
- **Adjust Wallet** - Add or deduct credits (enter amount in dollars)
- **Login As** - Generate a temporary session to view the customer dashboard as the customer
- **Delete** - Remove customer (careful: irreversible)

### Customer Data

Each customer record includes:
- Stripe customer ID and balance
- hosted.ai team ID
- Active pod count
- Lifecycle milestones (signup, first deposit, first GPU, LTV)
- Referral code and claims
- API keys for inference API

---

## Managing Administrators

**Tab:** Administrators (`?tab=admins`)

### Adding Admins

1. Click **"Add Admin"**
2. Enter the email address
3. The admin can log in with a magic link (if email configured) or you can set up their password

### Removing Admins

Click the trash icon next to any admin to revoke their access. They will be logged out on their next request.

### Admin Permissions

All admins have full access to all tabs and features. There is no role-based permission system - all admins are equal.

---

## GPU Pod Management

**Tab:** GPU Pods (`?tab=pods`)

### Pod Overview

View all active GPU pods across all customers:
- Pod name and display name
- GPU type and count
- Status (running, stopped, active, subscribed)
- Customer/team association
- Billing type and rate
- Uptime

### Pod Actions

From the admin panel you can view pod details and metrics. Pod lifecycle management (start, stop, restart, delete) is handled through the hosted.ai backend.

### Pod Metrics

Historical metrics are collected automatically:
- TFLOPS utilization
- VRAM usage
- GPU temperature, power draw
- Disk usage

---

## GPU Products & Pricing

### Products Tab (`?tab=products`)

Manage your GPU product catalog:

| Field | Description |
|-------|-------------|
| Name | Display name (e.g., "NVIDIA H100 80GB") |
| GPU Type | GPU model identifier |
| Pool IDs | hosted.ai pool IDs (comma-separated) |
| Billing Type | `hourly` or `monthly` |
| Price (hourly) | Price per hour in cents |
| Price (monthly) | Monthly subscription price in cents |
| Stripe Product ID | Links to Stripe product for subscriptions |
| Stripe Price ID | Links to Stripe price for subscriptions |

### Landing Page Tab (`?tab=landing`)

Configure the GPU offerings displayed on the marketing landing page carousel. Each offering includes name, GPU count, pricing, and a link to deploy.

### Cluster Offers Tab (`?tab=clusters`)

Create multi-GPU cluster offerings with tiered pricing (longer commitments = lower prices).

### Settings Tab (`?tab=settings`)

Configure global billing parameters:
- Default hourly rate
- Storage rate per GB
- Auto-refill wallet thresholds
- Minimum wallet balance

---

## Pool & Node Management

### Pool Overview (`?tab=pools`)

View all hosted.ai pools with:
- Available GPUs and regions
- Active subscriptions
- Pool settings (time quantum, overcommit ratio, security mode)
- Per-pool overrides

### Node Monitoring (`?tab=nodes`)

Real-time monitoring of all GPU nodes:
- Node health status
- GPU utilization
- Temperature and power
- Available capacity

### Pod Uptime (`?tab=uptime`)

Track daily uptime for all pods. Heartbeat-based monitoring shows availability over time.

---

## Inference API (LLM)

**Tab:** Token Providers (`?tab=token-providers`)

The inference API provides an OpenAI-compatible API for LLM inference, routing requests to a fleet of vLLM servers.

### Managing Inference Servers

View and manage the vLLM server fleet:
- Server IP, port, loaded model
- GPU type and VRAM
- Queue depth and KV cache usage
- Health status (ready, busy, offline)

### Pricing Configuration

Set per-token pricing:
- Realtime input/output price per 1M tokens
- Batch (1h SLA) pricing
- Batch (24h SLA) pricing
- Provider revenue share percentage

### Batch Jobs (`?tab=batches`)

Monitor batch inference jobs:
- Job status (queued, processing, completed, failed)
- Request count and progress
- Cost estimates vs actual

### API Endpoint

Customers access the inference API at `/api/v1/`:
- `POST /api/v1/chat/completions` - Chat completions (OpenAI compatible)
- `POST /api/v1/completions` - Text completions
- `POST /api/v1/embeddings` - Embeddings
- `GET /api/v1/models` - Available models
- Batch endpoints for async processing

---

## Provider Management

**Tab:** Providers (`?tab=providers`)

Manage GPU hardware providers who supply nodes to your platform.

### Provider Profiles

Each provider has:
- Company name, contact, legal entity
- Bank/payout details
- Node inventory
- Revenue and payout history

### Provider Nodes

View and manage individual GPU servers:
- Hardware specs (GPU type, count, VRAM)
- Connection status
- Revenue attribution
- Provisioning status (for GPUaaS)

### Commercial Terms

Set per-GPU-type agreements:
- Fixed rate per hour
- Revenue share percentage
- Minimum commitment periods

### Payouts (`?tab=payouts`)

Process provider payouts:
- View pending payout amounts
- Mark payouts as processed
- Track payout history with invoice references

### Node Revenue (`?tab=node-revenue`)

Detailed revenue reporting per node and per provider.

---

## Investor Portal

**Tab:** Investors (`?tab=investors`)

Manage investor accounts who share in GPU revenue:
- Revenue share percentages
- Pool ID assignments
- Earnings tracking
- Login-as feature for investor portal access

Investors can access their own portal at `/investor` showing:
- Revenue dashboards
- Node performance
- Payout history

---

## Billing & Wallets

### How Billing Works

Packet-OSS supports two billing models:

**Hourly (Prepaid Wallet)**
1. Customers fund their wallet via Stripe (credit card)
2. Cron jobs check hosted.ai usage and deduct from wallet
3. Low balance triggers email alerts
4. Optional auto-refill at configurable thresholds

**Monthly (Stripe Subscription)**
1. Customer subscribes to a monthly GPU plan
2. Stripe handles recurring billing automatically
3. Subscription lifecycle managed via webhooks

### Wallet Management

Wallet balance = Stripe customer balance (negative = credit).

Admin actions:
- View customer wallet balance
- Manually credit/debit wallet
- View transaction history (`WalletTransaction` records)

### Stripe Webhook Events

The webhook handler processes:
- `checkout.session.completed` - New customer onboarding
- `customer.subscription.created/updated/deleted` - Subscription lifecycle
- `payment_intent.succeeded` - Wallet top-up confirmation

---

## Email & Drip Campaigns

### Email Templates (`?tab=emails`)

Edit HTML email templates stored in the database. Templates use inline CSS styling and are sent via the Emailit API.

Available template types:
- Welcome / onboarding
- Login magic links
- Pod lifecycle events (deploy, stop, fail)
- Budget alerts
- Support ticket replies
- Quote notifications
- Provider notifications

### Drip Campaigns (`?tab=drip`)

Create automated email sequences triggered by customer events:

**Triggers:**
- `signup-free` - Free account created
- `signup-paid` - Paid account (first deposit)
- `gpu-deployed` - First GPU pod deployed

**Configuration:**
- Sequence name and trigger
- Steps with delay (hours/days after trigger)
- Email template per step
- Enrollment tracking and status

---

## Marketing & Analytics

### Marketing Tab (`?tab=marketing`)

View marketing analytics:
- UTM source attribution
- Page view tracking
- Customer acquisition sources
- Lifecycle stage distribution

### Campaign Banners (`?tab=banners`)

Create site-wide announcement banners:
- Banner text and link
- Background and text color
- Active/inactive toggle
- Dismissible by users

### Business Metrics (`?tab=business`)

High-level KPIs:
- Total customers and growth
- Active GPU pods
- Monthly Recurring Revenue (MRR)
- Revenue trends
- Customer acquisition cost metrics

---

## Support Tickets

**Tab:** Support (`?tab=support`)

Integration with Zammad support system (requires Zammad API configuration in Platform Settings):
- View all customer support tickets
- Read and respond to tickets
- Track ticket status and priority

---

## Referrals & Vouchers

### Referrals (`?tab=referrals`)

Manage the referral program:
- View all referral codes and their owners
- Track claims and qualified referrals
- Configure referral credit amounts

### Vouchers (`?tab=vouchers`)

Create promotional discount vouchers:
- Fixed credit amount
- Usage limits (single or multi-use)
- Expiration dates
- Track redemptions

---

## Two-Factor Authentication

Admins can enable TOTP-based two-factor authentication:

1. Go to the admin panel
2. Set up 2FA using any TOTP app (Google Authenticator, Authy, etc.)
3. Scan the QR code and enter the verification code
4. Save backup codes securely

After enabling 2FA, admins must enter a TOTP code after password login before accessing the admin panel.

### Admin PINs

A secondary PIN system is available for sensitive admin operations. PINs are set per-admin and hashed in the database.

---

## Cron Jobs

Packet-OSS uses HTTP-triggered cron jobs. Configure an external cron service (e.g., cron-job.org, AWS CloudWatch, systemd timer) to call these endpoints.

All cron endpoints require the `CRON_SECRET` header for authentication.

### Required Cron Jobs

| Endpoint | Frequency | Purpose |
|----------|-----------|---------|
| `/api/cron/midnight-status-email` | Daily | Send admin KPI summary email |
| `/api/cron/process-batches` | Every 1-5 min | Process queued batch inference jobs |

### Cron Authentication

Set the `CRON_SECRET` environment variable. Include it in requests as:
```
Authorization: Bearer <CRON_SECRET>
```
or:
```
x-cron-secret: <CRON_SECRET>
```

---

## Admin Sidebar Reference

The admin sidebar is organized into five groups:

### Setup
| Tab | Description |
|-----|-------------|
| Platform Settings | Configure API keys, integrations, branding |

### Users
| Tab | Description |
|-----|-------------|
| Customers | Customer management and wallet operations |
| Admins | Administrator account management |
| Investors | Investor portal management |
| Providers | GPU provider management |

### Infrastructure
| Tab | Description |
|-----|-------------|
| GPU Pods | Active pod management and monitoring |
| Pool Overview | hosted.ai pool status |
| Node Monitoring | Real-time node health |
| Token Providers | Inference server revenue |
| SkyPilot | SkyPilot cluster integration |
| Spheron Inventory | Spheron GPU deployments |
| Pod Uptime | Uptime tracking |

### Business
| Tab | Description |
|-----|-------------|
| Investor Payouts | Process payouts |
| Node Revenue | Per-node revenue reports |
| Inference | LLM inference management |
| Marketing | UTM analytics |
| Business Metrics | KPI dashboards |
| Products | GPU product catalog |
| Landing Page | Homepage GPU carousel |
| Clusters | Multi-GPU cluster offers |
| Demand | Infrastructure demand signals |
| Quotes | Sales quotes |
| Referrals | Referral program |
| Vouchers | Promotional credits |
| Banners | Site announcements |

### Tools
| Tab | Description |
|-----|-------------|
| Support | Support tickets (Zammad) |
| Batch Jobs | Inference batch monitoring |
| Email Templates | Edit email templates |
| Drip Campaigns | Automated email sequences |
| Game Stats | GPU Tetris game stats |
| Activity | Admin audit log |
| Calculator | Pricing calculator |
| QA | Quality assurance tools |
| Settings | Global billing configuration |
