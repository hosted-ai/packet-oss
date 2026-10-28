#!/usr/bin/env bash
#
# Ops wrapper for the one-time "First Deposit" organic recompute.
#
# The real logic (Stripe charge pagination + DB updates) lives in the TS script — bash just
# provides a safe, easy entrypoint. Defaults to DRY-RUN; writing requires explicit --apply.
#
#   ./scripts/recompute-organic-deposits.sh                 # dry-run, all rows (no writes)
#   ./scripts/recompute-organic-deposits.sh --limit 50      # dry-run, first 50 rows
#   ./scripts/recompute-organic-deposits.sh --apply         # WRITE (asks for confirmation)
#
# QA: point DATABASE_URL at a copy of prod (a dump), dry-run, review, THEN --apply on prod.
#
set -euo pipefail
cd "$(dirname "$0")/.."

apply=false
passthru=()
for a in "$@"; do
  case "$a" in
    --apply) apply=true ;;
    *) passthru+=("$a") ;;
  esac
done

if $apply; then
  echo "⚠️  This OVERWRITES deposit fields (firstDepositAt / totalDepositsCents / depositCount)"
  echo "    on live rows in the DB pointed to by DATABASE_URL."
  read -r -p "    Type 'yes' to proceed: " confirm
  [ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }
  exec npx tsx scripts/recompute-organic-deposits.ts "${passthru[@]}"
else
  echo "DRY RUN (no writes). Pass --apply to actually write."
  exec npx tsx scripts/recompute-organic-deposits.ts --dry-run "${passthru[@]}"
fi
