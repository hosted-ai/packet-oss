#!/usr/bin/env sh
# Posts a "PR ready for review" card to the Mattermost review channel.
#
# Runs as the final step of the PR pipeline, so in a fail-fast pipeline it only
# executes after a green build — i.e. the PR built/tested clean and now just needs
# reviewer approval. Fires on EVERY green build for the PR — it NEVER comments on the
# PR (no marker/dedup latch, by standing instruction), so it may re-announce on a
# later green build rather than latching against a marker comment.
#
# Each repo carries its own copy of this script; keep the reviewer map below in sync
# across them when it changes.
#
# Inert (fast no-op) unless BOTH are set — set them as workspace variables:
#   MATTERMOST_PR_WEBHOOK_URL — incoming webhook for the review channel
#   BITBUCKET_PR_API_TOKEN    — access token, scope: Pull requests READ
#                               (only ever reads the PR — never writes to it)
# No-ops on branch builds (no PR id). Never exits non-zero — a notification must
# not red a PR.
set +e

[ -z "${BITBUCKET_PR_ID:-}" ] && { echo "not a PR build — skipping"; exit 0; }
[ -z "${MATTERMOST_PR_WEBHOOK_URL:-}" ] && { echo "MATTERMOST_PR_WEBHOOK_URL unset — skipping"; exit 0; }
[ -z "${BITBUCKET_PR_API_TOKEN:-}" ] && { echo "BITBUCKET_PR_API_TOKEN unset — skipping"; exit 0; }

api="https://api.bitbucket.org/2.0/repositories/${BITBUCKET_REPO_FULL_NAME}/pullrequests/${BITBUCKET_PR_ID}"
auth="Authorization: Bearer ${BITBUCKET_PR_API_TOKEN}"

pr=$(curl -sf -H "$auth" "$api") || { echo "PR fetch failed — skipping (will retry next green build)"; exit 0; }
title=$(printf '%s' "$pr"  | jq -r '.title')
author=$(printf '%s' "$pr" | jq -r '.author.display_name // "unknown"')
src=$(printf '%s' "$pr"    | jq -r '.source.branch.name // "?"')
dst=$(printf '%s' "$pr"    | jq -r '.destination.branch.name // "?"')
url=$(printf '%s' "$pr"    | jq -r '.links.html.href')

# Who to ping: a static per-repo owner map keyed on the consuming repo's slug —
# NOT the PR's reviewer list. The @handles are Mattermost usernames and must match
# them exactly (a typo'd handle renders as plain text and notifies nobody). Keep
# this map in sync across every repo's copy.
case "${BITBUCKET_REPO_SLUG}" in
  sim_api|hostedai-user)                 reviewers="@noopur @akhil" ;;   # backend
  sim_ui|hostedai-user-ui|virtupian-ui)  reviewers="@hemanthn" ;;        # frontend
  virtupian-api|dash.packet.ai)          reviewers="@huzaif.fahad" ;;   # Packet
  haishare|haishare-multigpu)            reviewers="@biprodeep" ;;
  *)                                     reviewers="@julian" ;;          # everyone else
esac

# Same house style as the Trivy-alerts card (notify-mattermost-trivy.sh): ONE
# colour-barred attachment whose `text` is a compact markdown block — bold header,
# PR title + author, an italic branch line, and a single PR link. Real newlines so
# jq encodes them as \n (Mattermost renders \n as a line break).
body=$(printf '**%s — PR ready for review**\n%s · by %s\n_`%s` → `%s`_\n[Open pull request](%s)' \
  "${BITBUCKET_REPO_SLUG}" "$title" "$author" "$src" "$dst" "$url")

# The reviewer @mentions go in the post's TOP-LEVEL `text`, NOT in the attachment:
# Mattermost does not fire notifications for @user mentions placed inside an
# attachment (mattermost/mattermost#6029), so a mention in the card would render
# but never ping. Top-level text is the only reliable place, so it leads the post.
payload=$(jq -n \
  --arg mentions "$reviewers" \
  --arg body "$body" \
  --arg color "#2684FF" \
  '{text:$mentions, attachments:[{color:$color, text:$body}]}')

# Post to Mattermost only — this NEVER writes anything back to the PR (no comment).
if curl -sf -X POST -H 'Content-Type: application/json' -d "$payload" "$MATTERMOST_PR_WEBHOOK_URL"; then
  echo "announced PR #${BITBUCKET_PR_ID} to Mattermost"
else
  echo "Mattermost post failed"
fi
exit 0
