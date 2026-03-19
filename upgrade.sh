#!/usr/bin/env bash
# =============================================================================
# GPU Cloud Dashboard — Upgrade Script
# =============================================================================
# Upgrades an existing installation to the latest version.
#
# Usage:
#   sudo bash upgrade.sh
#   sudo bash upgrade.sh --branch v1.2.0    # Upgrade to specific branch/tag
#   sudo bash upgrade.sh --skip-backup      # Skip database backup
# =============================================================================

set -euo pipefail

APP_NAME="packet-oss"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
APP_USER="${APP_NAME}"
BRANCH="${BRANCH:-upgrade/hai-2.2}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${CYAN}[upgrade]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────────

SKIP_BACKUP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)      BRANCH="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=true; shift ;;
    *)             shift ;;
  esac
done

# ── Pre-flight checks ───────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (or with sudo)"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  fail "Installation not found at ${INSTALL_DIR}. Run install.sh first."
fi

if [[ ! -f "${INSTALL_DIR}/.env.local" ]]; then
  fail ".env.local not found. Installation may be corrupted."
fi

cd "$INSTALL_DIR"

# Mark repo as safe for git (owner is APP_USER, script runs as root)
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# Load env vars for prisma and build steps
ENV_VARS=$(grep -v '^#' "${INSTALL_DIR}/.env.local" | grep '=' | xargs)

# Extract DATABASE_URL for prisma
DB_URL=$(grep '^DATABASE_URL' "${INSTALL_DIR}/.env.local" | sed 's/DATABASE_URL=//' | tr -d '"')

# ── Get current version ─────────────────────────────────────────────────────

CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
log "Current version: ${CURRENT_VERSION}"
log "Upgrading to branch: ${BRANCH}"

# ── Step 1: Backup database ─────────────────────────────────────────────────

if ! $SKIP_BACKUP; then
  log "Backing up database..."

  if [[ "$DB_URL" == mysql://* ]]; then
    # Parse mysql://user:pass@host:port/dbname
    DB_USER=$(echo "$DB_URL" | sed 's|mysql://||' | cut -d: -f1)
    DB_PASS=$(echo "$DB_URL" | sed 's|mysql://||' | cut -d: -f2 | cut -d@ -f1)
    DB_HOST=$(echo "$DB_URL" | cut -d@ -f2 | cut -d: -f1)
    DB_PORT=$(echo "$DB_URL" | cut -d@ -f2 | cut -d: -f2 | cut -d/ -f1)
    DB_NAME=$(echo "$DB_URL" | rev | cut -d/ -f1 | rev)

    BACKUP_DIR="${INSTALL_DIR}/backups"
    mkdir -p "$BACKUP_DIR"
    chown "${APP_USER}:${APP_USER}" "$BACKUP_DIR"
    BACKUP_FILE="${BACKUP_DIR}/backup-${CURRENT_VERSION}-$(date +%Y%m%d%H%M%S).sql"

    DUMP_CMD="mysqldump"
    command -v mariadb-dump &>/dev/null && DUMP_CMD="mariadb-dump"

    if $DUMP_CMD -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" -P "$DB_PORT" "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null; then
      chown "${APP_USER}:${APP_USER}" "$BACKUP_FILE"
      success "Database backed up to backups/$(basename "$BACKUP_FILE")"
    else
      warn "Database backup failed — continuing upgrade anyway"
      rm -f "$BACKUP_FILE"
    fi
  else
    warn "Could not parse DATABASE_URL for backup — skipping"
  fi
else
  warn "Skipping database backup (--skip-backup)"
fi

# ── Step 2: Stop service ────────────────────────────────────────────────────

log "Stopping service..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
success "Service stopped"

# ── Step 3: Pull latest code ────────────────────────────────────────────────

log "Pulling latest code..."
sudo -u "$APP_USER" git fetch origin "$BRANCH"
sudo -u "$APP_USER" git checkout "$BRANCH" 2>/dev/null || sudo -u "$APP_USER" git checkout -b "$BRANCH" "origin/$BRANCH"
sudo -u "$APP_USER" git pull origin "$BRANCH"

NEW_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
success "Code updated (${CURRENT_VERSION} → ${NEW_VERSION})"

# ── Step 4: Install dependencies ────────────────────────────────────────────

log "Installing dependencies..."
sudo -u "$APP_USER" pnpm install --frozen-lockfile 2>/dev/null || sudo -u "$APP_USER" pnpm install
success "Dependencies installed"

# ── Step 5: Generate Prisma client & push schema ────────────────────────────

log "Generating Prisma client..."
sudo -u "$APP_USER" node node_modules/prisma/build/index.js generate
success "Prisma client generated"

log "Pushing database schema..."
sudo -u "$APP_USER" env DATABASE_URL="${DB_URL}" npx prisma db push --skip-generate
success "Database schema applied"

# ── Step 6: Build ───────────────────────────────────────────────────────────

log "Building application..."
sudo -u "$APP_USER" env ${ENV_VARS} pnpm build
success "Application built"

# ── Step 7: Start service ───────────────────────────────────────────────────

log "Starting service..."
systemctl daemon-reload
systemctl start "$SERVICE_NAME"

sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  success "Service is running"
else
  warn "Service may not have started. Check: journalctl -u ${SERVICE_NAME} -f"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
success "Upgrade complete! ${CURRENT_VERSION} → ${NEW_VERSION}"
echo "  Logs: journalctl -u ${SERVICE_NAME} -f"
echo "  Reconfigure: sudo bash reconfigure.sh (change domain, ports, SSL, etc.)"
echo ""
