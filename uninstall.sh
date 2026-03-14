#!/usr/bin/env bash
# =============================================================================
# GPU Cloud Dashboard — Uninstall Script
# =============================================================================
# Removes the GPU Cloud Dashboard installation.
#
# Usage:
#   sudo bash uninstall.sh              # Interactive (prompts before each step)
#   sudo bash uninstall.sh --yes        # Non-interactive (removes everything)
#   sudo bash uninstall.sh --keep-db    # Keep database intact
# =============================================================================

set -euo pipefail

APP_NAME="packet-oss"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
APP_USER="${APP_NAME}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${CYAN}[uninstall]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Parse args ───────────────────────────────────────────────────────────────

AUTO_YES=false
KEEP_DB=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)   AUTO_YES=true; shift ;;
    --keep-db)  KEEP_DB=true; shift ;;
    *)          shift ;;
  esac
done

confirm() {
  if $AUTO_YES; then return 0; fi
  read -rp "  $1 [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

# ── Pre-flight checks ───────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (or with sudo)"
fi

echo ""
warn "This will remove the GPU Cloud Dashboard from this system."
echo ""

if ! $AUTO_YES; then
  if ! confirm "Continue with uninstall?"; then
    echo "  Cancelled."
    exit 0
  fi
fi

# ── Step 1: Stop and disable service ────────────────────────────────────────

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  log "Stopping service..."
  systemctl stop "$SERVICE_NAME"
  success "Service stopped"
fi

if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
  systemctl disable "$SERVICE_NAME"
  success "Service disabled"
fi

if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  success "Service file removed"
fi

# ── Step 2: Optionally drop database ────────────────────────────────────────

if ! $KEEP_DB; then
  if [[ -f "${INSTALL_DIR}/.env.local" ]]; then
    DB_URL=$(grep '^DATABASE_URL' "${INSTALL_DIR}/.env.local" 2>/dev/null | sed 's/DATABASE_URL=//' | tr -d '"' || true)

    if [[ "$DB_URL" == mysql://* ]]; then
      DB_NAME=$(echo "$DB_URL" | rev | cut -d/ -f1 | rev)
      DB_USER_NAME=$(echo "$DB_URL" | sed 's|mysql://||' | cut -d: -f1)

      if confirm "Drop database '${DB_NAME}' and user '${DB_USER_NAME}'?"; then
        DB_CLIENT="mariadb"
        command -v mariadb &>/dev/null || DB_CLIENT="mysql"

        $DB_CLIENT -u root -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;" 2>/dev/null && \
          success "Database '${DB_NAME}' dropped" || \
          warn "Could not drop database (may require manual cleanup)"

        $DB_CLIENT -u root -e "DROP USER IF EXISTS '${DB_USER_NAME}'@'localhost';" 2>/dev/null && \
          success "Database user '${DB_USER_NAME}' dropped" || \
          warn "Could not drop user (may require manual cleanup)"
      else
        log "Keeping database"
      fi
    fi
  fi
else
  log "Keeping database (--keep-db)"
fi

# ── Step 3: Remove Apache config ─────────────────────────────────────────────

# Check for Apache2 vhost
if [[ -f "/etc/apache2/sites-enabled/${APP_NAME}.conf" ]] || \
   [[ -f "/etc/apache2/sites-available/${APP_NAME}.conf" ]]; then
  if confirm "Remove Apache vhost configuration?"; then
    a2dissite "${APP_NAME}.conf" 2>/dev/null || true
    a2dissite "${APP_NAME}-le-ssl.conf" 2>/dev/null || true
    rm -f "/etc/apache2/sites-available/${APP_NAME}.conf"
    rm -f "/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf"
    apache2ctl configtest 2>/dev/null && systemctl reload apache2 2>/dev/null
    success "Apache configuration removed"
  else
    log "Keeping Apache configuration"
  fi
fi

# Optionally revoke SSL certificate
if command -v certbot &>/dev/null; then
  CERT_DOMAIN=""
  if [[ -f "/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf" ]] 2>/dev/null; then
    CERT_DOMAIN=$(grep -oP 'ServerName\s+\K\S+' "/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf" 2>/dev/null || true)
  elif [[ -f "${INSTALL_DIR}/.env.local" ]]; then
    APP_URL=$(grep '^NEXT_PUBLIC_APP_URL' "${INSTALL_DIR}/.env.local" 2>/dev/null | sed 's/NEXT_PUBLIC_APP_URL=//' | tr -d '"' || true)
    CERT_DOMAIN=$(echo "$APP_URL" | sed 's|https://||' | sed 's|http://||' | cut -d/ -f1)
  fi

  if [[ -n "$CERT_DOMAIN" ]] && [[ "$CERT_DOMAIN" != "localhost" ]]; then
    if confirm "Revoke SSL certificate for '${CERT_DOMAIN}'?"; then
      certbot revoke --cert-name "$CERT_DOMAIN" --non-interactive 2>/dev/null && \
        certbot delete --cert-name "$CERT_DOMAIN" --non-interactive 2>/dev/null && \
        success "SSL certificate revoked for ${CERT_DOMAIN}" || \
        warn "Could not revoke certificate (may require manual cleanup)"
    else
      log "Keeping SSL certificate"
    fi
  fi
fi

# ── Step 4: Remove install directory ─────────────────────────────────────────

if [[ -d "$INSTALL_DIR" ]]; then
  if confirm "Remove installation directory ${INSTALL_DIR}?"; then
    rm -rf "$INSTALL_DIR"
    success "Installation directory removed"
  else
    log "Keeping ${INSTALL_DIR}"
  fi
fi

# ── Step 5: Remove system user ───────────────────────────────────────────────

if id "$APP_USER" &>/dev/null; then
  if confirm "Remove system user '${APP_USER}'?"; then
    userdel "$APP_USER" 2>/dev/null
    success "System user removed"
  else
    log "Keeping user '${APP_USER}'"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
success "GPU Cloud Dashboard has been uninstalled."
echo ""
