#!/usr/bin/env bash
# Post ONE aggregated CI result to a Mattermost channel from the per-step
# .result files written by run-ci-step.sh — replacing N per-step fail-only posts
# with a single message that lists every step (🟢/🔴) and, on failure, names
# what failed. Runs as the trailing "CI Result & Notify" step (NO on-fail:ignore
# of its own), and re-raises the aggregate status so the pipeline goes red when
# any gating step failed.
#
# Every gating step runs its command via run-ci-step.sh, carries
# `on-fail: strategy: ignore` (so a failure is red in the UI but the pipeline
# still reaches this step), and publishes `artifacts: [test-results/ci-steps/**]`.
#
# MM_EXPECTED (comma-separated step labels, e.g. "Lint,Unit tests,Build") makes
# the aggregate FAIL and flag any listed step that produced no result file —
# e.g. its setup/install died before recording, or its container was lost. This
# closes the false-green hole (a missing step would otherwise be silently
# omitted). Keep it in sync with the gating step labels. Match is by label.
#
# Usage (trailing step):
#   - MM_EXPECTED="Lint,Unit tests,Build,E2E smoke" MATTERMOST_WEBHOOK_URL="$MATTERMOST_QA_FRONTEND_WEBHOOK_URL" bash .bitbucket/notify-mattermost-ci-merged.sh
#
# SILENT ON SUCCESS, same as the Trivy security-scan step: a clean nightly run
# posts nothing at all; only a failure posts, with @channel. No per-repo bot
# identity override either — every repo posts under the webhook's own default
# name/icon (same as Trivy), so the shared channel shows one consistent avatar
# instead of a different bot per repo.
set -u

results_dir="${BITBUCKET_CLONE_DIR:-$PWD}/test-results/ci-steps"

branch="${BITBUCKET_BRANCH:-unknown}"
sha_short="${BITBUCKET_COMMIT:0:7}"
build="${BITBUCKET_BUILD_NUMBER:-?}"
repo="${BITBUCKET_REPO_FULL_NAME:-unknown}"
repo_name="${repo##*/}"
pipeline_url="https://bitbucket.org/${repo}/pipelines/results/${build}"
ts="$(date +%s 2>/dev/null || echo 0)"

if [[ -n "${BITBUCKET_PR_ID:-}" ]]; then
    trigger="pre-merge · PR #${BITBUCKET_PR_ID}"
elif [[ "$branch" != "unknown" ]]; then
    trigger="${branch} (scheduled/manual)"
else
    trigger="manual"
fi

# Recorded step labels present (field 2 of each .result). No associative arrays
# so this stays bash-3.2 portable; a step's result is looked up by label via awk.
present_labels=$(awk -F'\t' 'NF>=2 {print $2}' "$results_dir"/*.result 2>/dev/null | sort -u)

lookup_ec() {  # label -> its exit code, or empty if the step produced no result
    awk -F'\t' -v want="$1" '$2==want {print $1; exit}' "$results_dir"/*.result 2>/dev/null
}

overall=0
n_fail=0
raw=""
shown=""
# Collect each step as "name<TAB>result"; the aligned render happens after the
# loop (needs the longest name first).
emit_row() {
    local lbl="$1" ec status
    case "$shown" in *"[$lbl]"*) return 0 ;; esac   # de-dup
    shown="${shown}[$lbl]"
    ec=$(lookup_ec "$lbl")
    if [[ -z "$ec" ]]; then
        status="no result"; overall=1; n_fail=$((n_fail + 1))
    elif [[ "$ec" == "0" ]]; then
        status="passed"
    else
        status="failed"; overall=1; n_fail=$((n_fail + 1))
    fi
    raw+="${lbl}"$'\t'"${status}"$'\n'
}

if [[ -n "${MM_EXPECTED:-}" ]]; then
    IFS=',' read -ra _exp <<< "$MM_EXPECTED"
    for lbl in "${_exp[@]}"; do
        [[ -z "$lbl" ]] && continue
        emit_row "$lbl"
    done
    # Any recorded step not named in MM_EXPECTED (defensive — surfaces drift).
    while IFS= read -r lbl; do
        [[ -z "$lbl" ]] && continue
        emit_row "$lbl"
    done <<< "$present_labels"
elif [[ -z "$present_labels" ]]; then
    overall=1
    raw="(no step results recorded)"$'\t'"—"$'\n'
else
    while IFS= read -r lbl; do
        [[ -z "$lbl" ]] && continue
        emit_row "$lbl"
    done <<< "$present_labels"
fi

# Compact Trivy-alert card: count the steps and collect any that didn't pass.
n_total=0
failed_list=""
while IFS=$'\t' read -r _lbl _st; do
    [[ -z "$_lbl" ]] && continue
    n_total=$((n_total + 1))
    [[ "$_st" != "passed" ]] && failed_list+="• ${_lbl} (${_st})"$'\n'
done <<< "$raw"

meta="${trigger} · build #${build} · ${branch} @ ${sha_short}"

webhook="${MATTERMOST_WEBHOOK_URL:-}"
# This channel now carries NIGHTLY results only. PR builds still run this step
# (they aggregate + re-raise the gate below) but must NOT post — so a PR build
# skips the post entirely, regardless of webhook. A clean run is equally silent
# — report-only, "silence = clean", same as the Trivy step.
if [[ -n "${BITBUCKET_PR_ID:-}" ]]; then
    echo "notify-mattermost-ci-merged: PR build (#${BITBUCKET_PR_ID}); skipping post — nightly-only channel." >&2
elif [[ "$overall" == "0" ]]; then
    echo "notify-mattermost-ci-merged: ${repo_name} passed — quiet on success, no notification." >&2
elif [[ -z "$webhook" ]]; then
    echo "notify-mattermost-ci-merged: MATTERMOST_WEBHOOK_URL not set; skipping post." >&2
else
    # ⚠ + red bar, @channel INLINE (special mentions notify from inside an attachment).
    color="#d50000"
    text_body=$(printf '@channel ⚠ **%s — nightly CI failed — %s of %s step(s)**\n%s_%s_\n[Pipeline](%s)' \
        "$repo_name" "$n_fail" "$n_total" "$failed_list" "$meta" "$pipeline_url")

    json_escape() {
        local s=$1
        s=${s//\\/\\\\}
        s=${s//\"/\\\"}
        s=${s//$'\n'/\\n}
        printf '%s' "$s"
    }

    # ONE colour-barred attachment, no username/icon_emoji override — same shape
    # as the Trivy alerts, same single default identity too.
    payload=$(printf '{"attachments":[{"color":"%s","text":"%s"}]}' \
        "$color" "$(json_escape "$text_body")")

    curl -sS -o /dev/null -w "mattermost HTTP %{http_code}\n" \
        --max-time 15 --retry 2 \
        -X POST -H "Content-Type: application/json" \
        --data "$payload" \
        "$webhook" \
        || echo "notify-mattermost-ci-merged: curl failed (non-fatal)" >&2
fi

# Re-raise the aggregate status so the pipeline goes red when any step failed.
exit "$overall"
