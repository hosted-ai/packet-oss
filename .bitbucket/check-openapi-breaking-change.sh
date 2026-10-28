#!/usr/bin/env bash
# PA-261 acceptance criterion: "any change to tests/contract/openapi.yaml
# requires a breaking-change label or PR comment to merge." Bitbucket Cloud
# has no native PR-label API (unlike GitHub), so this reuses the marker-comment
# pattern already established by notify-pr-ready.sh — a PR comment containing
# the literal text "breaking-change" is the confirmation.
#
# Not a gate on API changes in general — only on changes to the committed
# contract spec, which is the reviewable diff of what the tested surface
# guarantees. Fails CLOSED (blocks) only once BOTH: (a) it's a PR build with
# the spec actually changed, and (b) BITBUCKET_PR_API_TOKEN is configured to
# check for the marker. With no PR context or no token, it reports and
# no-ops — same graceful-degradation convention as this repo's other
# workspace-var-gated scripts.
set -u

[ -z "${BITBUCKET_PR_ID:-}" ] && { echo "not a PR build — skipping"; exit 0; }

dest="${BITBUCKET_PR_DESTINATION_BRANCH:-main}"
git fetch --depth=50 origin "$dest" >/dev/null 2>&1

if git diff --quiet FETCH_HEAD...HEAD -- tests/contract/openapi.yaml 2>/dev/null; then
  echo "tests/contract/openapi.yaml unchanged — nothing to gate"
  exit 0
fi

echo "tests/contract/openapi.yaml changed on this PR:"
git diff --stat FETCH_HEAD...HEAD -- tests/contract/openapi.yaml

if [ -z "${BITBUCKET_PR_API_TOKEN:-}" ]; then
  echo "BITBUCKET_PR_API_TOKEN unset — cannot check for the breaking-change marker, skipping (report-only)"
  exit 0
fi

api="https://api.bitbucket.org/2.0/repositories/${BITBUCKET_REPO_FULL_NAME}/pullrequests/${BITBUCKET_PR_ID}"
auth="Authorization: Bearer ${BITBUCKET_PR_API_TOKEN}"

# Plain grep over the raw comments JSON rather than a jq dependency — a
# case-insensitive substring match on the marker is all this needs.
if curl -sf -H "$auth" "${api}/comments?pagelen=100" | grep -qi "breaking-change"; then
  echo "found a 'breaking-change' PR comment — confirmed intentional, passing"
  exit 0
fi

echo ""
echo "BLOCKED: tests/contract/openapi.yaml changed but no PR comment contains 'breaking-change'."
echo "If this is an intentional, reviewed API change, add a PR comment containing the words"
echo "\"breaking-change\" to confirm and re-run this check."
exit 1
