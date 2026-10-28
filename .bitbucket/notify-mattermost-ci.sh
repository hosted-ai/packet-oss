#!/usr/bin/env bash
# Post a per-repo CI pass/fail summary to a Mattermost channel via an incoming
# webhook. Generic sibling of hostedai_autotests/.bitbucket/
# notify-mattermost-autotest.sh, trimmed for unit/component CI (no ReportPortal
# launch, no pytest summary sidecar).
#
# ── How it's wired (see bitbucket-pipelines.yml) ────────────────────────────
# Each check step calls this from its `after-script:` in FAIL-ONLY mode, so a
# green check stays silent and a red check posts one line naming that check:
#
#   after-script:
#     - MATTERMOST_WEBHOOK_URL="$MATTERMOST_QA_PACKET_WEBHOOK_URL" MM_ONLY_ON_FAIL=1 bash .bitbucket/notify-mattermost-ci.sh "Lint"
#
# A trailing "Notify (success)" step runs only when every prior step passed and
# posts the single green message. It forces pass because $BITBUCKET_EXIT_CODE is
# populated by Bitbucket only in an after-script: phase, not in a normal script:
#
#   script:
#     - MATTERMOST_WEBHOOK_URL="$MATTERMOST_QA_PACKET_WEBHOOK_URL" MM_STATUS=pass bash .bitbucket/notify-mattermost-ci.sh "CI"
#
# ── Status resolution ───────────────────────────────────────────────────────
#   MM_STATUS=pass|fail        explicit override (used by the success step)
#   else $BITBUCKET_EXIT_CODE  (Bitbucket sets this in after-script: 0 = passed)
#
# ── Inputs ──────────────────────────────────────────────────────────────────
#   $1                       label for this check (e.g. "Lint", "CI")
#   MATTERMOST_WEBHOOK_URL   incoming-webhook URL (channel is baked into it).
#                            Map the channel's workspace variable to this name
#                            inline, e.g. MATTERMOST_WEBHOOK_URL="$MATTERMOST_QA_PACKET_WEBHOOK_URL".
#   MM_ONLY_ON_FAIL=1        stay silent on success (used by check steps)
#
# Silently skips when MATTERMOST_WEBHOOK_URL is unset, so forks / PRs without
# the workspace variable configured don't error.
set -u

label="${1:-CI}"

webhook="${MATTERMOST_WEBHOOK_URL:-}"
if [[ -z "$webhook" ]]; then
    echo "notify-mattermost-ci: MATTERMOST_WEBHOOK_URL not set; skipping." >&2
    exit 0
fi

# Resolve pass/fail.
if [[ -n "${MM_STATUS:-}" ]]; then
    [[ "$MM_STATUS" == "pass" ]] && exit_code=0 || exit_code=1
else
    exit_code="${BITBUCKET_EXIT_CODE:-1}"
fi

# Fail-only mode: stay silent on success.
if [[ "${MM_ONLY_ON_FAIL:-0}" == "1" && "$exit_code" == "0" ]]; then
    exit 0
fi

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

# Per-channel bot identity (Style 6). Repos sharing a QA channel share a name +
# emoji so a cross-posted alert is identifiable at a glance.
case "$repo_name" in
    sim_ui|hostedai-user-ui)      bot_name="QA Frontend CI";     bot_icon=":art:" ;;
    sim_api|hostedai-user)        bot_name="QA Backend CI";      bot_icon=":gear:" ;;
    my.hosted.ui|my.hosted.api)   bot_name="QA Marketplace CI";  bot_icon=":shopping_trolley:" ;;
    dash.packet.ai)               bot_name="QA Packet CI";       bot_icon=":package:" ;;
    hostedai_autotests)           bot_name="HAI Autotests";      bot_icon=":robot_face:" ;;
    *)                            bot_name="QA CI";              bot_icon=":robot_face:" ;;
esac

if [[ "$exit_code" == "0" ]]; then
    title="✓ ${repo_name} — ${label} passed"
    color="#36a64f"
    pretext=""
else
    title="✗ ${repo_name} — ${label} failed"
    color="#d50000"
    pretext="@channel"
fi

# Build the structured attachment payload with printf, NOT jq: the CI runner
# images don't reliably ship jq (Bitbucket Cloud go/node images don't) and the
# shape is fixed. json_escape covers the values that could carry JSON-special
# characters; branch/commit/url/build are already ref-safe.
json_escape() {
    local s=$1
    s=${s//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\n'/\\n}
    printf '%s' "$s"
}

payload=$(printf '{"username":"%s","icon_emoji":"%s","attachments":[{"color":"%s","pretext":"%s","title":"%s","title_link":"%s","fields":[{"title":"Trigger","value":"%s","short":true},{"title":"Build","value":"#%s","short":true},{"title":"Branch","value":"`%s`","short":true},{"title":"Commit","value":"`%s`","short":true}],"footer":"Bitbucket Pipelines","ts":%s}]}' \
    "$(json_escape "$bot_name")" "$bot_icon" "$color" "$(json_escape "$pretext")" \
    "$(json_escape "$title")" "$pipeline_url" "$(json_escape "$trigger")" "$build" \
    "$(json_escape "$branch")" "$sha_short" "$ts")

curl -sS -o /dev/null -w "mattermost HTTP %{http_code}\n" \
    --max-time 15 --retry 2 \
    -X POST -H "Content-Type: application/json" \
    --data "$payload" \
    "$webhook" \
    || echo "notify-mattermost-ci: curl failed (non-fatal)" >&2
