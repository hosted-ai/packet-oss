# Changelog

All notable changes to GPU Cloud Dashboard will be documented in this file.

## [0.1.2] - 2026-03-20

### Added
- Password-based admin login (no email provider needed for first setup)
- TOTP two-factor authentication for admin accounts
- Admin invite system with one-time setup tokens
- Login audit log with security health score
- Platform Settings UI for configuring all integrations from the admin panel
- DB-backed settings with AES-256-GCM encryption for sensitive keys
- SMTP email support (replaces vendor-specific email providers)
- Admin-customizable email templates
- Capability-based feature gating with informational banners
- `reconfigure.sh` for post-install configuration changes (domain, SSL, ports)
- `upgrade.sh` for zero-downtime upgrades
- `uninstall.sh` for clean removal
- VERSION file for deterministic version tracking

### Changed
- Install script defaults to `main` branch
- All scripts point to `github.com/hosted-ai/packet-oss`

### Removed
- Docker support (not yet implemented — will return in a future release)
