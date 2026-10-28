#!/usr/bin/env sh
# Stops this PR pipeline when a newer push has moved the source branch past its commit, so
# the runners go to the run that matters. CI plumbing never fails a run: any API error continues.
set -u

api="https://api.bitbucket.org/2.0/repositories/${BITBUCKET_REPO_FULL_NAME:-}"

log() { printf 'stop-if-superseded: %s\n' "$*"; }

# Only a pull-request run can be superseded; nightly and branch runs always continue.
[ -n "${BITBUCKET_PR_ID:-}" ] || { log "not a pull-request run; continuing"; exit 0; }

for v in BITBUCKET_REPO_FULL_NAME BITBUCKET_BRANCH BITBUCKET_COMMIT BITBUCKET_PIPELINE_UUID \
         BITBUCKET_EMAIL BITBUCKET_API_TOKEN; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { log "$v is unset; continuing the run"; exit 0; }
done

# The credential goes to curl on stdin, so it never appears in the runner's process list.
bb() {
  printf 'user = "%s:%s"\n' "$BITBUCKET_EMAIL" "$BITBUCKET_API_TOKEN" \
    | curl -sS --globoff --max-time 15 -K - -w '\n%{http_code}' "$@"
}

# Percent-encodes what a branch name may hold that would break a URL path; "/" stays literal.
encode() { printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/ /%20/g' -e 's/#/%23/g' -e 's/?/%3F/g'; }

resp="$(bb "$api/refs/branches/$(encode "$BITBUCKET_BRANCH")?fields=target.hash")" \
  || { log "branch lookup failed (curl); continuing the run"; exit 0; }
code="$(printf '%s' "$resp" | tail -n 1)"
[ "$code" = "200" ] || { log "branch lookup returned HTTP $code; continuing the run"; exit 0; }
head="$(printf '%s' "$resp" | sed '$d' | grep -o '[0-9a-f]\{40\}' | head -n 1)"
[ -n "$head" ] || { log "no commit hash in the branch lookup; continuing the run"; exit 0; }

if [ "$head" = "$BITBUCKET_COMMIT" ]; then
  log "$BITBUCKET_COMMIT is the head of $BITBUCKET_BRANCH; running the pipeline"
  exit 0
fi

log "SUPERSEDED: PR #${BITBUCKET_PR_ID:-?} branch $BITBUCKET_BRANCH is now at $head, this run tests $BITBUCKET_COMMIT; stopping it"
uuid="$(printf '%s' "$BITBUCKET_PIPELINE_UUID" | sed -e 's/{/%7B/g' -e 's/}/%7D/g')"
resp="$(bb -X POST "$api/pipelines/$uuid/stopPipeline")" \
  || { log "stop request failed (curl); continuing the run"; exit 0; }
code="$(printf '%s' "$resp" | tail -n 1)"
case "$code" in
  2??) log "stop requested (HTTP $code)" ;;
  *)   log "stop returned HTTP $code; continuing the run" ;;
esac
exit 0
