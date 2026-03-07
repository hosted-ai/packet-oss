# Contributing to Packet-OSS

Thank you for your interest in contributing to Packet-OSS! This document provides guidelines and information for contributors.

> **Note:** This platform is built on [hosted.ai](https://hosted.ai). GPU features require a hosted.ai account and API credentials. Visit [hosted.ai](https://hosted.ai) to get access for development and testing.

## Table of Contents

- [Development Setup](#development-setup)
- [Architecture Overview](#architecture-overview)
- [Module Structure](#module-structure)
- [Coding Standards](#coding-standards)
- [Pull Request Process](#pull-request-process)

## Development Setup

### Prerequisites

- **[hosted.ai](https://hosted.ai) account** - Required for GPU features (API URL + API key)
- Node.js 18+
- pnpm (recommended) or npm
- SQLite (included, no separate installation needed)

### Initial Setup

```bash
# Clone the repository
git clone <repository-url>
cd packet

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run database migrations
npx prisma migrate dev

# Start development server
pnpm dev
```

### Environment Variables

See `.env.example` for all required environment variables. Key variables:

- `STRIPE_SECRET_KEY` - Stripe API key for payments
- `HOSTEDAI_API_URL` / `HOSTEDAI_API_KEY` - GPU infrastructure API
- `EMAILIT_API_KEY` - Transactional email service
- `ADMIN_JWT_SECRET` - JWT signing secret

## Architecture Overview

Packet-OSS is a Next.js 16 application that provides:

1. **Customer Dashboard** - GPU instance management, billing, SSH access
2. **Admin Dashboard** - Customer management, system configuration
3. **Marketing Site** - Landing pages

### Technology Stack

- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS
- **Database**: SQLite with Prisma ORM
- **Authentication**: JWT-based with magic link login
- **Payments**: Stripe (subscriptions + wallet)
- **GPU Infrastructure**: hosted.ai API

### Route Structure

```
src/app/
├── (marketing)/    # Public landing page
├── account/        # Customer login flow
├── dashboard/      # Authenticated customer area
├── admin/          # Admin dashboard
├── investors/      # Investor portal
└── api/            # API routes
```

## Module Structure

The `src/lib/` directory contains shared business logic organized by domain:

### Domain Modules

```
src/lib/
├── auth/           # Authentication (customer, admin, investor, 2FA)
│   ├── customer.ts # Customer JWT tokens
│   ├── admin.ts    # Admin JWT + file-based storage
│   ├── investor.ts # Investor JWT + file-based storage
│   ├── two-factor.ts # TOTP 2FA implementation
│   └── index.ts    # Barrel exports
│
├── email/          # Email services
│   ├── client.ts   # Emailit API client
│   ├── templates/  # Email templates (welcome, login, etc.)
│   └── index.ts    # Barrel exports
│
├── hostedai/       # GPU infrastructure integration
│   ├── client.ts   # API client with caching
│   ├── pools.ts    # GPU pool subscriptions
│   ├── teams.ts    # Team management
│   ├── billing.ts  # Usage and billing data
│   ├── types.ts    # TypeScript interfaces
│   └── index.ts    # Barrel exports
│
└── [other modules] # Standalone utilities
```

### Backwards Compatibility

Legacy import paths (e.g., `@/lib/customer-auth`) are maintained via re-export shims. New code should import from the modular paths:

```typescript
// Preferred
import { generateCustomerToken } from "@/lib/auth/customer";
import { sendWelcomeEmail } from "@/lib/email";

// Legacy (still works)
import { generateCustomerToken } from "@/lib/customer-auth";
```

## Coding Standards

### TypeScript

- Use strict TypeScript with explicit types
- Export types alongside functions
- Use `unknown` over `any` where possible

### File Organization

- One module = one responsibility
- Barrel exports via `index.ts`
- Colocate types with their implementations

### Naming Conventions

- Files: `kebab-case.ts`
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

### Error Handling

- Use typed error responses for API routes
- Log errors with context (but never log secrets)
- Return user-friendly error messages

### Security

- Never hardcode secrets - use environment variables
- Validate all user input
- Use parameterized queries (Prisma handles this)
- Sanitize data before rendering

## Pull Request Process

### Before Submitting

1. **Test locally**: Run `pnpm build` and verify no errors
2. **Run linting**: Run `pnpm lint` and fix any issues
3. **Update types**: Ensure TypeScript compiles without errors
4. **Test features**: Manually test affected functionality

### PR Guidelines

1. **Branch naming**: `feature/`, `fix/`, `refactor/`, `docs/`
2. **Commit messages**: Use conventional commits
   - `feat:` New features
   - `fix:` Bug fixes
   - `refactor:` Code restructuring
   - `docs:` Documentation
   - `chore:` Maintenance tasks
3. **Description**: Explain what and why, not just how
4. **Size**: Keep PRs focused - one feature/fix per PR

### Review Process

1. All PRs require review before merging
2. Address feedback promptly
3. Squash commits when merging

## Questions?

Open an issue for questions or feature discussions.
