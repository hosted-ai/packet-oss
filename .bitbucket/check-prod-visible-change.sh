#!/usr/bin/env bash
# A promote is per-package, not per-commit: merging here does not deploy to
# prod, but the next promote anyone runs ships the whole package, and they
# will be diffing only their own commits. So the gate belongs at merge time,
# where the author knows what the change is, not at promote time.
#
# Gates customer-visible paths only; backend changes merge freely. Bitbucket
# has no PR-label API, so confirmation is a marker comment — the same pattern
# as check-openapi-breaking-change.sh. Fails closed only on a PR build with a
# real change AND a token to check with; otherwise reports and no-ops.
set -u

MARKER="prod-ready"

[ -z "${BITBUCKET_PR_ID:-}" ] && { echo "not a PR build — skipping"; exit 0; }

dest="${BITBUCKET_PR_DESTINATION_BRANCH:-main}"
git fetch --depth=50 origin "$dest" >/dev/null 2>&1

# Customer-visible means anything a customer or a visitor renders: the
# signed-in dashboard, the public marketing site, and the shell around both.
changed=$(git diff --name-only FETCH_HEAD...HEAD -- \
  'src/app/dashboard/**' \
  'src/app/(marketing)/**' \
  'src/components/Marketing*' \
  'src/app/globals.css' \
  'src/app/**/layout.tsx' \
  'src/app/layout.tsx' 2>/dev/null)

if [ -z "$changed" ]; then
  echo "no customer-visible paths changed — nothing to gate"
  exit 0
fi

echo "This PR changes paths customers see on prod once promoted:"
echo "$changed" | sed 's/^/  /'
echo ""

if [ -z "${BITBUCKET_PR_API_TOKEN:-}" ]; then
  echo "BITBUCKET_PR_API_TOKEN unset — cannot check for the '$MARKER' marker, skipping (report-only)"
  exit 0
fi

api="https://api.bitbucket.org/2.0/repositories/${BITBUCKET_REPO_FULL_NAME}/pullrequests/${BITBUCKET_PR_ID}"
auth="Authorization: Bearer ${BITBUCKET_PR_API_TOKEN}"

# Plain grep over the comments JSON rather than adding a jq dependency.
if curl -sf -H "$auth" "${api}/comments?pagelen=100" | grep -qi "$MARKER"; then
  echo "found a '$MARKER' PR comment — confirmed intentional, passing"
  exit 0
fi

cat <<EOF
BLOCKED: this PR puts customer-visible changes on the prod runway.

Merging does not deploy to prod by itself. But the next promote anyone runs
carries these commits with it, whoever they are and whatever they were
shipping. Decide now, not then:

  * It should ship  -> comment "$MARKER" on this PR and re-run.
  * It should not   -> hold it on this branch, or put it behind a flag that
                       is off in prod, until it is wanted.

Changed:
$(echo "$changed" | sed 's/^/  /')
EOF
exit 1
