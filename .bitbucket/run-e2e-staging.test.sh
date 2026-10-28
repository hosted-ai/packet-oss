#!/usr/bin/env bash
# ponytail self-check for run-e2e-staging.sh's one branch: no token -> skip
# (exit 0, no playwright invocation), rather than silently going further.
set -euo pipefail
cd "$(dirname "$0")"

out=$(unset E2E_STAGING_AUTH_TOKEN; bash run-e2e-staging.sh 2>&1)
ec=$?

[[ "$ec" -eq 0 ]] || { echo "FAIL: expected exit 0 with no token, got $ec"; exit 1; }
[[ "$out" == *"E2E_STAGING_AUTH_TOKEN unset; skipping"* ]] || { echo "FAIL: expected skip message, got: $out"; exit 1; }

echo "ok: run-e2e-staging.sh skips cleanly when E2E_STAGING_AUTH_TOKEN is unset"
