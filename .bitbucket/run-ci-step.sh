#!/usr/bin/env bash
# Run one gating CI command and record its pass/fail for the single aggregated
# end-of-run Mattermost notification (notify-mattermost-ci-merged.sh), then
# re-raise the command's exit code. Pair with `on-fail: strategy: ignore` on the
# step so a failure shows red in the UI but the pipeline still reaches the
# trailing notify step.
#
# Usage in a step's script:
#   - bash .bitbucket/run-ci-step.sh "Type check" -- npm run ts
#
# Writes test-results/ci-steps/<slug>.result = "<exit>\t<label>". The step must
# publish `artifacts: [test-results/ci-steps/**]` so the trailing step sees it.
# One file per step (distinct slug) — no parallel-artifact filename collision.
set -u

label="$1"; shift
[[ "${1:-}" == "--" ]] && shift
if [[ $# -eq 0 ]]; then
    echo "run-ci-step: no command given after --" >&2
    exit 2
fi

results_dir="${BITBUCKET_CLONE_DIR:-$PWD}/test-results/ci-steps"
mkdir -p "$results_dir"
slug=$(printf '%s' "$label" | LC_ALL=C tr 'A-Z' 'a-z' | LC_ALL=C tr -c 'a-z0-9' '-')

"$@"
ec=$?
printf '%s\t%s\n' "$ec" "$label" > "$results_dir/${slug}.result"
exit "$ec"
