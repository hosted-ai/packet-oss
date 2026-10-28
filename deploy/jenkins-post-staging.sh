#!/bin/bash
#
# Jenkins -post hook: upgrade dash-staging.packet.ai after a successful
# internal-devel build.
#
# jenkins-debian.sh runs this only after `apt-add` has published the .deb to the
# repo tier, so there is no race between publish and install.
#
# internal-devel, not internal-staging: dash-staging.packet.ai reads
# apt-internal.devel.hosted.ai. The internal-staging tier is a holding area that
# nothing installs from — it exists so golive has something to promote to stable.
#
# PRODUCTION IS NEVER UPGRADED HERE. dash.packet.ai reads apt-internal.hosted.ai
# and receives only what golive/apt-hai has deliberately promoted.
#
# Note this restarts the dashboard on staging and runs its Prisma migrations
# (postinst does that on upgrade) against the staging database.
#
set -euo pipefail

# Attached on internal-devel and nowhere else, so any other value means this and
# the Jenkinsfile have drifted — fail, because skipping strands a published deb.
if [[ "${REPO_TARGET:-}" != "internal-devel" ]]; then
  echo "post: ERROR REPO_TARGET='${REPO_TARGET:-unset}', expected 'internal-devel'." >&2
  echo "post: the hook is attached only on internal-devel — Jenkinsfile and this script disagree." >&2
  exit 1
fi

# Unconfigured is a state, not a failure: skip loudly rather than reddening every
# build until the agent-to-staging SSH path exists. Configured-but-ineffective
# still fails, below.
if [[ -z "${PACKET_STAGING_HOST:-}" ]]; then
  echo "post: SKIPPED — PACKET_STAGING_HOST is not set on the Jenkins agent."
  echo "post: the package published fine; nothing was deployed."
  echo "post: set it under Manage Jenkins > System > Global properties > Environment variables."
  exit 0
fi

sshUser="${PACKET_STAGING_USER:-jenkins}"

echo "post: upgrading packetai-dashboard on staging (${sshUser}@${PACKET_STAGING_HOST})"

ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "${sshUser}@${PACKET_STAGING_HOST}" bash -seu <<'REMOTE'
sudo apt-get update -qq

# --only-upgrade so this never installs the package on a host that was not
# already provisioned for it; first install stays a deliberate act.
before=$(dpkg-query -W -f='${Version}' packetai-dashboard 2>/dev/null || echo none)
sudo apt-get install -y --only-upgrade packetai-dashboard
after=$(dpkg-query -W -f='${Version}' packetai-dashboard 2>/dev/null || echo none)
echo "post: packetai-dashboard ${before} -> ${after}"

# An unchanged version means apt had nothing to install — almost always because
# the host subscribes to a different tier than the one just published to. Fail
# loudly: a deploy that silently upgrades nothing is worse than a red build.
if [ "$before" = "$after" ]; then
  echo "post: ERROR version did not change; is this host subscribed to the tier we published to?" >&2
  grep -h "hosted.ai" /etc/apt/sources.list.d/*.list 2>/dev/null >&2 || true
  exit 1
fi

# postinst restarts both units; fail the build if either did not come back.
systemctl is-active --quiet packetai-dashboard.service
systemctl is-active --quiet packetai-dashboard-ssh-ws.service
echo "post: packetai-dashboard and ssh-ws are active"
REMOTE

echo "post: staging upgrade complete"
