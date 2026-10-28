#!/usr/bin/env bash
# Self-check for stop-if-superseded.sh: a run with no PR id never calls the API,
# and a PR run whose commit is no longer the branch head asks to stop.
set -uo pipefail
cd "$(dirname "$0")"

stub=$(mktemp -d)
trap 'rm -rf "$stub"' EXIT
calls="$stub/calls"
head_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

# A curl that records each call and answers the branch lookup with head_sha.
printf '#!/bin/sh\necho "$*" >> "%s"\ncat >/dev/null\nprintf "{\\"target\\":{\\"hash\\":\\"%s\\"}}\\n200"\n' \
  "$calls" "$head_sha" > "$stub/curl"
chmod +x "$stub/curl"

run() {
  env -i PATH="$stub:/usr/bin:/bin" \
    BITBUCKET_REPO_FULL_NAME=ws/repo BITBUCKET_BRANCH=feature \
    BITBUCKET_COMMIT=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    BITBUCKET_PIPELINE_UUID='{0000}' BITBUCKET_EMAIL=ci@example.com BITBUCKET_API_TOKEN=x \
    "$@" sh stop-if-superseded.sh 2>&1
}

: > "$calls"
out=$(run) || { echo "FAIL: non-PR run exited non-zero: $out"; exit 1; }
[ ! -s "$calls" ] || { echo "FAIL: non-PR run called the API: $(cat "$calls")"; exit 1; }
[[ "$out" == *"not a pull-request run; continuing"* ]] || { echo "FAIL: non-PR run said: $out"; exit 1; }

: > "$calls"
out=$(run BITBUCKET_PR_ID=7) || { echo "FAIL: PR run exited non-zero: $out"; exit 1; }
grep -q 'stopPipeline' "$calls" || { echo "FAIL: superseded PR run did not request a stop: $out"; exit 1; }

echo "ok: stop-if-superseded.sh skips non-PR runs and stops a superseded PR run"
