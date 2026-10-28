#!/usr/bin/env bash
# What a promote would actually ship. A promote is per-package, so it carries
# every commit on main since the version prod is running — not just yours.
#
# Usage: deploy/prod-runway.sh <version-prod-is-running>   e.g. 0.8.103
# Find that with: ssh <prod-host> 'dpkg -l packetai-dashboard'
set -eu

[ $# -eq 1 ] || { echo "usage: $0 <prod-version>   e.g. $0 0.8.103" >&2; exit 2; }
want="$1"

cd "$(dirname "$0")/.."
git fetch -q origin main

# The changelog bot writes one entry per build, so the commit that first
# introduced this version header is the release boundary.
base=$(git log --format=%H -S"packetai-dashboard ($want" --reverse -- debian/changelog | head -1)
[ -n "$base" ] || { echo "no changelog entry for $want — is that the right version?" >&2; exit 1; }

range="$base..origin/main"
count=$(git rev-list --count "$range")
echo "prod runs $want; $count commit(s) would ship with the next promote."
echo ""

if [ "$count" -eq 0 ]; then echo "Nothing pending."; exit 0; fi

git log --format='  %h %an%x09%s' "$range" | grep -v 'update debian changelog'
echo ""

visible=$(git diff --name-only "$range" -- \
  'src/app/dashboard/**' 'src/app/globals.css' \
  'src/app/**/layout.tsx' 'src/app/layout.tsx' 2>/dev/null)

if [ -z "$visible" ]; then
  echo "No customer-visible paths in this window — backend only."
  exit 0
fi

echo "CUSTOMER-VISIBLE files in this window — these change what customers see:"
echo "$visible" | sed 's/^/  /'
echo ""
echo "Confirm every author above expects their change to ship before promoting."
exit 1
