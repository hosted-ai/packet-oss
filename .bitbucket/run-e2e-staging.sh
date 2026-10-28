#!/usr/bin/env bash
# Run the Playwright E2E suite against staging as the Slow-tier CI step
# (merge-to-main + nightly; PA-264). Never runs on PRs.
#
# Quarantined specs (test title tagged `@quarantine`) are excluded so a known
# flake doesn't redden the aggregate — see "Flake quarantine" in TESTING.md.
#
# Needs a secured pipeline variable for staging auth:
#   E2E_STAGING_AUTH_TOKEN
# Unset -> logs and exits 0 (skip), same no-op-if-unset pattern as the
# Mattermost/coverage-baseline steps, until staging auth is wired.
set -u

token="${E2E_STAGING_AUTH_TOKEN:-}"
if [[ -z "$token" ]]; then
    echo "run-e2e-staging: E2E_STAGING_AUTH_TOKEN unset; skipping E2E run." >&2
    exit 0
fi

npx playwright install --with-deps chromium

TEST_BASE_URL="${E2E_STAGING_BASE_URL:-https://dash-staging.packet.ai}" \
TEST_AUTH_TOKEN="$token" \
    pnpm exec playwright test --grep-invert @quarantine
