# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Email**: Send details to security@example.com
2. **Include**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours of your report
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release cycle

### Responsible Disclosure

- Please do not publicly disclose the vulnerability until we've had a chance to address it
- We will credit you in our security advisories (unless you prefer to remain anonymous)
- We do not pursue legal action against researchers who follow responsible disclosure

## Security-Related Environment Variables

The following environment variables are critical for security. See `.env.example` for the full list.

| Variable | Purpose |
|----------|---------|
| `ADMIN_JWT_SECRET` | Secret for signing JWT tokens (customer, admin, investor) |
| `STRIPE_SECRET_KEY` | Stripe API key - never expose to client |
| `STRIPE_WEBHOOK_SECRET` | Validates incoming Stripe webhooks |
| `HOSTEDAI_API_KEY` | hosted.ai API authentication |
| `EMAILIT_API_KEY` | Email service authentication |

### Best Practices

1. **Never commit secrets**: All secrets should be in `.env.local` (gitignored)
2. **Rotate keys regularly**: Especially after team member departures
3. **Use environment-specific keys**: Different keys for dev/staging/production
4. **Limit access**: Only grant production access to those who need it

## Known Vulnerabilities

### Transitive Dependency: qs (via stripe)

**Status**: Unfixable (waiting for upstream fix)

| Severity | Package | Issue |
|----------|---------|-------|
| High | qs <6.14.1 | DoS via memory exhaustion (GHSA-6rw7-vpxm-498p) |

**Mitigation**:
- This vulnerability is in the `stripe` package's dependency tree
- The qs library is used for query string parsing
- **Impact**: Limited - only affects Stripe webhook parsing, not user-facing APIs
- **Mitigation**: Stripe webhooks have signature verification and rate limiting
- **Resolution**: Will be fixed when Stripe updates their qs dependency

To check for vulnerabilities:
```bash
pnpm audit
```

## Security Features

### Authentication

- **JWT-based**: Stateless authentication with signed tokens
- **Token Expiry**: Customer tokens expire in 24h, admin sessions in 1h
- **Two-Factor Auth**: TOTP-based 2FA for admin accounts
- **Magic Links**: Passwordless login reduces credential theft risk

### Authorization

- **Role-based**: Separate customer, admin, and investor roles
- **Stripe Integration**: Customer identity tied to Stripe customer ID
- **Team Isolation**: Data scoped to hosted.ai teams

### Data Protection

- **SQLite with WAL**: Local database with write-ahead logging
- **No PII in Logs**: Sensitive data redacted from console output
- **HTTPS Only**: All production traffic encrypted

### Input Validation

- **API Validation**: Request bodies validated before processing
- **SQL Injection**: Prisma ORM prevents injection attacks
- **XSS Prevention**: React's default escaping + manual HTML sanitization

## Audit History

| Date | Auditor | Scope | Result |
|------|---------|-------|--------|
| 2025-01-01 | Internal | Dependency scan | 1 transitive vuln (documented above) |
