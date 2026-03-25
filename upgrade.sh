#!/usr/bin/env bash
# =============================================================================
# GPU Cloud Dashboard — Upgrade & Rollback Script
# =============================================================================
# Upgrades an existing installation to the latest version, or rolls back
# to the previous version if something goes wrong.
#
# Usage:
#   sudo bash upgrade.sh                    # Upgrade to latest main
#   sudo bash upgrade.sh --branch v1.2.0    # Upgrade to specific branch/tag
#   sudo bash upgrade.sh --skip-backup      # Skip database backup
#   sudo bash upgrade.sh --rollback         # Roll back to pre-upgrade state
# =============================================================================

set -euo pipefail

APP_NAME="packet-oss"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
APP_USER="${APP_NAME}"
BRANCH="${BRANCH:-main}"
STATE_FILE="${INSTALL_DIR}/.upgrade-state"

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
DO_ROLLBACK=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)      BRANCH="$2"; shift 2 ;;
    --skip-backup) SKIP_BACKUP=true; shift ;;
    --rollback)    DO_ROLLBACK=true; shift ;;
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

# Ensure .env symlink exists so Prisma (which only auto-loads .env) works
ln -sf .env.local "${INSTALL_DIR}/.env"

cd "$INSTALL_DIR"

# Mark repo as safe for git (owner is APP_USER, script runs as root)
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# Fix ownership — a prior root operation (manual git pull, failed upgrade) can leave
# .git/objects owned by root, which blocks git fetch/pull as APP_USER.
chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.git" 2>/dev/null || true

# Load env vars for prisma and build steps
ENV_VARS=$(grep -v '^#' "${INSTALL_DIR}/.env.local" | grep '=' | xargs)

# Extract DATABASE_URL for prisma
DB_URL=$(grep '^DATABASE_URL' "${INSTALL_DIR}/.env.local" | sed 's/DATABASE_URL=//' | tr -d '"')

# ── Rollback ─────────────────────────────────────────────────────────────────

if $DO_ROLLBACK; then
  if [[ ! -f "$STATE_FILE" ]]; then
    fail "No rollback state found. You can only roll back immediately after an upgrade."
  fi

  # Read breadcrumb
  PREV_SHA=$(grep '^PREV_SHA=' "$STATE_FILE" | cut -d= -f2-)
  PREV_VERSION=$(grep '^PREV_VERSION=' "$STATE_FILE" | cut -d= -f2-)
  ENV_BACKUP=$(grep '^ENV_BACKUP=' "$STATE_FILE" | cut -d= -f2-)
  DB_BACKUP=$(grep '^DB_BACKUP=' "$STATE_FILE" | cut -d= -f2-)

  if [[ -z "$PREV_SHA" ]]; then
    fail "Rollback state is corrupt (missing PREV_SHA)."
  fi

  CURRENT_VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
  echo ""
  log "Rolling back: ${CURRENT_VERSION} → ${PREV_VERSION:-$PREV_SHA}"
  echo ""
  echo "  This will:"
  echo "    1. Stop the service"
  echo "    2. Restore code to commit ${PREV_SHA:0:12}"
  [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]] && echo "    3. Restore .env.local from backup"
  [[ -n "$DB_BACKUP" && -f "$DB_BACKUP" ]] && echo "    4. Restore database from backup"
  echo "    5. Reinstall dependencies and rebuild"
  echo "    6. Start the service"
  echo ""
  read -rp "  Continue? [y/N] " CONFIRM < /dev/tty
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "  Rollback cancelled."
    exit 0
  fi

  # Step R1: Stop service
  log "Stopping service..."
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  success "Service stopped"

  # Step R2: Restore code
  log "Restoring code to ${PREV_SHA:0:12}..."
  sudo -u "$APP_USER" git checkout "$PREV_SHA"
  success "Code restored"

  # Step R3: Restore .env.local
  if [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]]; then
    log "Restoring .env.local..."
    cp "$ENV_BACKUP" "${INSTALL_DIR}/.env.local"
    chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.env.local"
    chmod 600 "${INSTALL_DIR}/.env.local"
    # Reload env vars from restored file
    ENV_VARS=$(grep -v '^#' "${INSTALL_DIR}/.env.local" | grep '=' | xargs)
    DB_URL=$(grep '^DATABASE_URL' "${INSTALL_DIR}/.env.local" | sed 's/DATABASE_URL=//' | tr -d '"')
    success "Restored .env.local"
  fi

  # Step R4: Restore database
  if [[ -n "$DB_BACKUP" && -f "$DB_BACKUP" ]]; then
    log "Restoring database from backup..."
    if [[ "$DB_URL" == mysql://* ]]; then
      DB_USER=$(echo "$DB_URL" | sed 's|mysql://||' | cut -d: -f1)
      DB_PASS=$(echo "$DB_URL" | sed 's|mysql://||' | cut -d: -f2 | cut -d@ -f1)
      DB_HOST=$(echo "$DB_URL" | cut -d@ -f2 | cut -d: -f1)
      DB_PORT=$(echo "$DB_URL" | cut -d@ -f2 | cut -d: -f2 | cut -d/ -f1)
      DB_NAME=$(echo "$DB_URL" | rev | cut -d/ -f1 | rev)

      MYSQL_CMD="mysql"
      command -v mariadb &>/dev/null && MYSQL_CMD="mariadb"

      if $MYSQL_CMD -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" -P "$DB_PORT" "$DB_NAME" < "$DB_BACKUP" 2>/dev/null; then
        success "Database restored"
      else
        warn "Database restore failed — the database may need manual attention"
      fi
    else
      warn "Could not parse DATABASE_URL — skipping database restore"
    fi
  else
    warn "No database backup available — skipping database restore"
    warn "Schema may have changed. You may need to run: npx prisma db push"
  fi

  # Step R5: Reinstall + rebuild
  log "Installing dependencies..."
  sudo -u "$APP_USER" pnpm install --frozen-lockfile 2>/dev/null || sudo -u "$APP_USER" pnpm install
  success "Dependencies installed"

  log "Generating Prisma client..."
  sudo -u "$APP_USER" node node_modules/prisma/build/index.js generate
  success "Prisma client generated"

  log "Building application..."
  sudo -u "$APP_USER" env ${ENV_VARS} pnpm build
  success "Application built"

  # Step R6: Start service
  log "Starting service..."
  systemctl daemon-reload
  systemctl start "$SERVICE_NAME"

  sleep 3
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    success "Service is running"
  else
    warn "Service may not have started. Check: journalctl -u ${SERVICE_NAME} -f"
  fi

  # Clean up state file
  rm -f "$STATE_FILE"

  RESTORED_VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
  echo ""
  success "Rollback complete! Restored to ${RESTORED_VERSION} (${PREV_SHA:0:12})"
  echo "  Logs: journalctl -u ${SERVICE_NAME} -f"
  echo ""
  exit 0
fi

# ── Upgrade ──────────────────────────────────────────────────────────────────

# ── Get current version ─────────────────────────────────────────────────────

CURRENT_VERSION=$(cat VERSION 2>/dev/null || node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
log "Current version: ${CURRENT_VERSION} (${CURRENT_SHA:0:12})"
log "Upgrading to branch: ${BRANCH}"

# ── Step 1: Backup database ─────────────────────────────────────────────────

BACKUP_FILE=""

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
      BACKUP_FILE=""
    fi
  else
    warn "Could not parse DATABASE_URL for backup — skipping"
  fi
else
  warn "Skipping database backup (--skip-backup)"
fi

# ── Step 1b: Backup .env.local ──────────────────────────────────────────────

ENV_BACKUP="${INSTALL_DIR}/backups/.env.local.pre-upgrade.$(date +%Y%m%d%H%M%S)"
mkdir -p "${INSTALL_DIR}/backups"
cp "${INSTALL_DIR}/.env.local" "$ENV_BACKUP"
chown "${APP_USER}:${APP_USER}" "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
success "Backed up .env.local"

# ── Step 1c: Save rollback state ────────────────────────────────────────────

cat > "$STATE_FILE" <<EOF
# Upgrade rollback state — created $(date -Iseconds)
# Run: sudo bash upgrade.sh --rollback
PREV_SHA=${CURRENT_SHA}
PREV_VERSION=${CURRENT_VERSION}
ENV_BACKUP=${ENV_BACKUP}
DB_BACKUP=${BACKUP_FILE}
UPGRADE_DATE=$(date -Iseconds)
EOF
chown "${APP_USER}:${APP_USER}" "$STATE_FILE"
chmod 600 "$STATE_FILE"

# ── Step 2: Stop service ────────────────────────────────────────────────────

log "Stopping service..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
success "Service stopped"

# ── Step 3: Pull latest code ────────────────────────────────────────────────

log "Pulling latest code..."
sudo -u "$APP_USER" git fetch origin "$BRANCH"
sudo -u "$APP_USER" git checkout "$BRANCH" 2>/dev/null || sudo -u "$APP_USER" git checkout -b "$BRANCH" "origin/$BRANCH"
sudo -u "$APP_USER" git pull origin "$BRANCH"

NEW_VERSION=$(cat VERSION 2>/dev/null || node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
success "Code updated (${CURRENT_VERSION} → ${NEW_VERSION})"

# ── Step 3b: Migrate legacy env var names ─────────────────────────────────
# GPUAAS_ADMIN_* → HOSTEDAI_ADMIN_* (renamed for consistency)

ENV_FILE="${INSTALL_DIR}/.env.local"
MIGRATED=false

migrate_env_var() {
  local old_name="$1" new_name="$2"
  if grep -q "^${old_name}=" "$ENV_FILE" 2>/dev/null && ! grep -q "^${new_name}=" "$ENV_FILE" 2>/dev/null; then
    local value
    value=$(grep "^${old_name}=" "$ENV_FILE" | sed "s/^${old_name}=//")
    sed -i "s/^${old_name}=.*/${new_name}=${value}/" "$ENV_FILE"
    MIGRATED=true
  fi
}

migrate_env_var "GPUAAS_ADMIN_URL"      "HOSTEDAI_ADMIN_URL"
migrate_env_var "GPUAAS_ADMIN_USER"     "HOSTEDAI_ADMIN_USERNAME"
migrate_env_var "GPUAAS_ADMIN_PASSWORD" "HOSTEDAI_ADMIN_PASSWORD"

if $MIGRATED; then
  # Also update the comment line if present
  sed -i 's/# HostedAI Admin Panel.*cookie-based.*/# HostedAI Admin Panel (port 8999) — cookie-based login auth/' "$ENV_FILE" 2>/dev/null || true
  success "Migrated legacy env vars (GPUAAS_ADMIN_* → HOSTEDAI_ADMIN_*)"
  # Reload env vars after migration
  ENV_VARS=$(grep -v '^#' "${ENV_FILE}" | grep '=' | xargs)
fi

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

log "Seeding database..."
sudo -u "$APP_USER" env DATABASE_URL="${DB_URL}" npx prisma db seed 2>/dev/null && success "Database seeded" || warn "Seed skipped (no seed script or already up to date)"

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
echo "  Logs:     journalctl -u ${SERVICE_NAME} -f"
echo "  Rollback: sudo bash upgrade.sh --rollback"
echo "  Reconfigure: sudo bash reconfigure.sh (change domain, ports, SSL, etc.)"
echo ""
