#!/usr/bin/env bash
# =============================================================================
# GPU Cloud Dashboard — Install Script
# =============================================================================
# Installs the GPU Cloud Dashboard on a fresh Linux server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hosted-ai/packet-oss/main/install.sh | sudo bash
#   HOSTEDAI_API_URL=http://localhost:5000 sudo bash install.sh   # Non-interactive
#   sudo bash install.sh --skip-apache                             # Skip Apache setup
#
# Supports:
#   - Same-node as HAI (recommended): HOSTEDAI_API_URL=http://localhost:<port>
#   - Separate server: HOSTEDAI_API_URL=https://hai-server.example.com
# =============================================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────

APP_NAME="packet-oss"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
APP_USER="${APP_NAME}"
APP_PORT=3000
SSH_WS_PORT=3002
DB_NAME="packetdb_oss"
DB_USER="packetos_user"
REPO_URL="https://github.com/hosted-ai/packet-oss"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${CYAN}[install]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}✗ $1${NC}"; exit 1; }

# Run a command with an elapsed-time spinner.  Usage: run_with_progress "message" command args...
run_with_progress() {
  local msg="$1"; shift
  local start=$SECONDS
  local pid

  # Run command in background, redirect output to log file
  local logfile="/tmp/packet-oss-install-$$.log"
  "$@" > "$logfile" 2>&1 &
  pid=$!

  # Spinner loop — show elapsed time
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local elapsed=$(( SECONDS - start ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))
    printf "\r  ${CYAN}%s${NC} %s ${YELLOW}[%d:%02d]${NC} " "${spin:i++%${#spin}:1}" "$msg" "$mins" "$secs"
    sleep 0.2
  done

  # Get exit code
  wait "$pid"
  local exit_code=$?
  local elapsed=$(( SECONDS - start ))
  local mins=$(( elapsed / 60 ))
  local secs=$(( elapsed % 60 ))

  # Clear spinner line
  printf "\r%-80s\r" ""

  if [[ $exit_code -eq 0 ]]; then
    success "$msg ${YELLOW}[${mins}m ${secs}s]${NC}"
    rm -f "$logfile"
  else
    echo ""
    echo -e "${RED}✗ $msg failed after ${mins}m ${secs}s${NC}"
    echo ""
    echo -e "${RED}Last 30 lines of log:${NC}"
    tail -30 "$logfile"
    echo ""
    echo -e "${YELLOW}Full log: $logfile${NC}"
    exit 1
  fi
  return $exit_code
}

# ── Parse args ───────────────────────────────────────────────────────────────

SKIP_APACHE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-apache)  SKIP_APACHE=true; shift ;;
    --branch)       BRANCH="$2"; shift 2 ;;
    --domain)       DOMAIN="$2"; shift 2 ;;
    *)              shift ;;
  esac
done

# ── Pre-flight checks ───────────────────────────────────────────────────────

log "Checking prerequisites..."

if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (or with sudo)"
fi

# Check OS
if [[ ! -f /etc/os-release ]]; then
  fail "Unsupported OS — this script requires a systemd-based Linux distribution"
fi
source /etc/os-release

# Check Node.js — install v20 if missing or too old
NEED_NODE=false
if ! command -v node &>/dev/null; then
  NEED_NODE=true
else
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VERSION" -lt 18 ]]; then
    warn "Node.js 18+ required (found v${NODE_VERSION}), upgrading..."
    NEED_NODE=true
  fi
fi

if $NEED_NODE; then
  run_with_progress "Installing Node.js 20" bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y -qq nodejs"
fi
success "Node.js $(node -v)"

# Check pnpm
if ! command -v pnpm &>/dev/null; then
  log "Installing pnpm..."
  npm install -g pnpm
fi
success "pnpm $(pnpm -v)"

# Check MariaDB
if ! command -v mariadb &>/dev/null && ! command -v mysql &>/dev/null; then
  fail "MariaDB/MySQL is not installed. Install MariaDB 10.6+ first:
    apt-get install -y mariadb-server
    systemctl enable --now mariadb"
fi
success "MariaDB/MySQL detected"

# Check git
if ! command -v git &>/dev/null; then
  fail "git is not installed. Install with: apt-get install -y git"
fi

success "All prerequisites met"

# ── Gather configuration ────────────────────────────────────────────────────

echo ""
log "Configuration"
echo ""

# Domain name
if [[ -z "$DOMAIN" ]]; then
  echo "  Enter the domain name for the dashboard."
  echo "  Examples: dash.example.com, gpu.mycompany.io"
  echo "  Leave blank for localhost (no SSL)."
  echo ""
  read -rp "  Domain: " DOMAIN < /dev/tty
fi

# HostedAI API
if [[ -z "${HOSTEDAI_API_URL:-}" ]]; then
  echo ""
  echo "  Is the HostedAI User Panel + Admin Panel installed on this server?"
  read -rp "  Same node? [Y/n] " SAME_NODE < /dev/tty
  SAME_NODE="${SAME_NODE:-Y}"

  if [[ "$SAME_NODE" =~ ^[Yy]$ ]]; then
    HOSTEDAI_API_URL="http://localhost:8055"
    GPUAAS_ADMIN_URL="http://localhost:8999"
    success "Using local HostedAI APIs (user: :8055, admin: :8999)"
  else
    echo ""
    echo "  HostedAI User Panel API URL (port 8055):"
    echo "    Example: https://user-panel.example.com"
    read -rp "  HOSTEDAI_API_URL: " HOSTEDAI_API_URL < /dev/tty

    echo ""
    echo "  HostedAI Admin Panel API URL (port 8999):"
    echo "    Example: https://admin-panel.example.com"
    read -rp "  GPUAAS_ADMIN_URL: " GPUAAS_ADMIN_URL < /dev/tty
  fi
fi

# User Panel API key (generated in the HostedAI User Panel)
if [[ -z "${HOSTEDAI_API_KEY:-}" ]]; then
  echo ""
  echo "  HostedAI User Panel API key."
  echo "  Generate one in the HostedAI User Panel, or configure later in admin UI."
  read -rp "  HOSTEDAI_API_KEY (Enter to skip): " HOSTEDAI_API_KEY < /dev/tty
fi

# Admin Panel credentials (login/password auth — no API key)
echo ""
echo "  HostedAI Admin Panel login credentials (used for pod management)."
if [[ -z "${GPUAAS_ADMIN_USER:-}" ]]; then
  read -rp "  GPUAAS_ADMIN_USER: " GPUAAS_ADMIN_USER < /dev/tty
fi
if [[ -z "${GPUAAS_ADMIN_PASSWORD:-}" ]]; then
  read -srp "  GPUAAS_ADMIN_PASSWORD: " GPUAAS_ADMIN_PASSWORD < /dev/tty
  echo ""
fi

# Stripe (optional)
if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  read -rp "  STRIPE_SECRET_KEY (optional, press Enter to skip): " STRIPE_SECRET_KEY < /dev/tty
fi

# Admin email (optional — for certbot and first admin bootstrap)
if [[ -z "${ADMIN_EMAIL:-}" ]]; then
  read -rp "  Admin email (for SSL certificate and first login): " ADMIN_EMAIL < /dev/tty
fi

# Generate secrets (may be overridden by existing .env.local below)
ADMIN_JWT_SECRET=$(openssl rand -hex 32)
CUSTOMER_JWT_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)
ENCRYPTION_KEY=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 16)

# If .env.local already exists, extract DB password from it so we don't
# overwrite it with a new random one (ALTER USER must match .env.local)
if [[ -f "${INSTALL_DIR}/.env.local" ]]; then
  _EXISTING_DB_URL=$(grep "^DATABASE_URL=" "${INSTALL_DIR}/.env.local" 2>/dev/null | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' || true)
  if [[ -n "$_EXISTING_DB_URL" ]]; then
    DB_PASSWORD=$(echo "$_EXISTING_DB_URL" | sed 's|mysql://[^:]*:\([^@]*\)@.*|\1|')
    log "Using existing database password from .env.local"
  fi
fi

# Determine app URL
if [[ -n "$DOMAIN" ]]; then
  APP_URL="https://${DOMAIN}"
else
  APP_URL="http://localhost:${APP_PORT}"
fi

# ── Step 1: Create system user ──────────────────────────────────────────────

log "Creating system user '${APP_USER}'..."
if id "$APP_USER" &>/dev/null; then
  success "User '${APP_USER}' already exists"
else
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"
  success "Created user '${APP_USER}'"
fi

# ── Step 2: Create MariaDB database ─────────────────────────────────────────

log "Setting up MariaDB database..."

DB_CLIENT="mariadb"
if ! command -v mariadb &>/dev/null; then
  DB_CLIENT="mysql"
fi

sudo $DB_CLIENT -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

success "Database '${DB_NAME}' ready (user: ${DB_USER})"

# ── Step 3: Clone/install application ────────────────────────────────────────

log "Installing application to ${INSTALL_DIR}..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
  run_with_progress "Pulling latest code" bash -c "cd ${INSTALL_DIR} && (sudo -u ${APP_USER} git pull origin ${BRANCH} 2>/dev/null || git pull origin ${BRANCH})"
else
  run_with_progress "Cloning repository" bash -c "git clone --depth 1 --branch ${BRANCH} ${REPO_URL} ${INSTALL_DIR} && chown -R ${APP_USER}:${APP_USER} ${INSTALL_DIR}"
fi

cd "$INSTALL_DIR"

# ── Step 4: Create/update .env.local ─────────────────────────────────────────

ENV_FILE="${INSTALL_DIR}/.env.local"

# Helper: get existing value from .env.local (returns empty string if not set)
get_existing() {
  if [[ -f "$ENV_FILE" ]]; then
    grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | sed "s/^${1}=//" | tr -d '"' || true
  fi
}

if [[ -f "$ENV_FILE" ]]; then
  log "Existing .env.local found — merging (preserving existing values)..."

  # Preserve existing secrets and credentials — never overwrite these
  ADMIN_JWT_SECRET=$(get_existing ADMIN_JWT_SECRET)
  ADMIN_JWT_SECRET="${ADMIN_JWT_SECRET:-$(openssl rand -hex 32)}"

  CUSTOMER_JWT_SECRET=$(get_existing CUSTOMER_JWT_SECRET)
  CUSTOMER_JWT_SECRET="${CUSTOMER_JWT_SECRET:-$(openssl rand -hex 32)}"

  CRON_SECRET=$(get_existing CRON_SECRET)
  CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 16)}"

  ENCRYPTION_KEY=$(get_existing ENCRYPTION_KEY)
  ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -hex 32)}"

  # Preserve DB URL if set — extract password from it to keep DB user in sync
  EXISTING_DB_URL=$(get_existing DATABASE_URL)
  if [[ -n "$EXISTING_DB_URL" ]]; then
    DB_URL_FINAL="$EXISTING_DB_URL"
    # Extract password from URL: mysql://user:PASSWORD@host:port/db
    DB_PASSWORD=$(echo "$EXISTING_DB_URL" | sed 's|mysql://[^:]*:\([^@]*\)@.*|\1|')
  else
    DB_URL_FINAL="mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}"
  fi

  # Preserve user-configured values
  HOSTEDAI_API_URL=$(get_existing HOSTEDAI_API_URL)
  HOSTEDAI_API_URL="${HOSTEDAI_API_URL:-${HOSTEDAI_API_URL}}"

  HOSTEDAI_API_KEY=$(get_existing HOSTEDAI_API_KEY)
  HOSTEDAI_API_KEY="${HOSTEDAI_API_KEY:-${HOSTEDAI_API_KEY}}"

  GPUAAS_ADMIN_URL=$(get_existing GPUAAS_ADMIN_URL)
  GPUAAS_ADMIN_URL="${GPUAAS_ADMIN_URL:-http://localhost:8999}"

  GPUAAS_ADMIN_USER=$(get_existing GPUAAS_ADMIN_USER)
  GPUAAS_ADMIN_USER="${GPUAAS_ADMIN_USER:-${GPUAAS_ADMIN_USER}}"

  GPUAAS_ADMIN_PASSWORD=$(get_existing GPUAAS_ADMIN_PASSWORD)
  GPUAAS_ADMIN_PASSWORD="${GPUAAS_ADMIN_PASSWORD:-${GPUAAS_ADMIN_PASSWORD}}"

  STRIPE_SECRET_KEY=$(get_existing STRIPE_SECRET_KEY)
  STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-${STRIPE_SECRET_KEY}}"
else
  log "Writing new configuration..."
  DB_URL_FINAL="mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}"
fi

# Back up existing .env.local before overwriting
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > "$ENV_FILE" <<EOF
# GPU Cloud Dashboard — Generated by install.sh on $(date -Iseconds)
NEXT_PUBLIC_EDITION=oss
EDITION=oss
NEXT_PUBLIC_APP_URL=${APP_URL}

# Database
DATABASE_URL="${DB_URL_FINAL}"

# Auth secrets (auto-generated — preserved across re-installs)
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
CUSTOMER_JWT_SECRET=${CUSTOMER_JWT_SECRET}
CRON_SECRET=${CRON_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# HostedAI User Panel (port 8055)
HOSTEDAI_API_URL=${HOSTEDAI_API_URL:-}
HOSTEDAI_API_KEY=${HOSTEDAI_API_KEY:-}

# HostedAI Admin Panel (port 8999) — cookie-based login auth
GPUAAS_ADMIN_URL=${GPUAAS_ADMIN_URL:-http://localhost:8999}
GPUAAS_ADMIN_USER=${GPUAAS_ADMIN_USER:-}
GPUAAS_ADMIN_PASSWORD=${GPUAAS_ADMIN_PASSWORD:-}

# Stripe (optional — configure in admin UI if not set here)
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}

# SSH WebSocket
SSH_WS_PORT=${SSH_WS_PORT}
EOF

chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
chmod 600 "$ENV_FILE"
success "Configuration written to .env.local"

# ── Step 5: Install dependencies & build ─────────────────────────────────────

cd "$INSTALL_DIR"
run_with_progress "Installing dependencies" sudo -u "$APP_USER" bash -c "cd ${INSTALL_DIR} && pnpm install --frozen-lockfile 2>/dev/null || pnpm install"

run_with_progress "Generating Prisma client" sudo -u "$APP_USER" node node_modules/prisma/build/index.js generate

run_with_progress "Pushing database schema" sudo -u "$APP_USER" env DATABASE_URL="${DB_URL_FINAL}" npx prisma db push --accept-data-loss

run_with_progress "Building application" sudo -u "$APP_USER" bash -c "cd ${INSTALL_DIR} && env \$(grep -v '^#' .env.local | xargs) pnpm build"

# ── Step 6: Create systemd service ──────────────────────────────────────────

log "Creating systemd service..."

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=GPU Cloud Dashboard
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which npx) next start -H 127.0.0.1 -p ${APP_PORT}
Restart=on-failure
RestartSec=5
StartLimitBurst=10
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/.env.local

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${INSTALL_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
success "Systemd service created"

# ── Step 7: Configure Apache2 ───────────────────────────────────────────────

if ! $SKIP_APACHE; then
  log "Setting up Apache2..."

  # Install Apache2 if not present
  if ! command -v apache2 &>/dev/null; then
    log "Installing Apache2..."
    apt-get update -qq
    apt-get install -y -qq apache2
  fi
  success "Apache2 installed"

  # Enable required modules
  a2enmod proxy proxy_http proxy_wstunnel rewrite headers ssl 2>/dev/null
  success "Apache modules enabled"

  if [[ -n "$DOMAIN" ]]; then
    # ── Domain mode: HTTP vhost + certbot for SSL ──

    # Create HTTP vhost (certbot will create SSL vhost from this)
    cat > "/etc/apache2/sites-available/${APP_NAME}.conf" <<APACHE
<VirtualHost *:80>
    ServerName ${DOMAIN}
    ServerAdmin ${ADMIN_EMAIL:-webmaster@${DOMAIN}}

    # Proxy to Next.js
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${APP_PORT}/
    ProxyPassReverse / http://127.0.0.1:${APP_PORT}/

    # WebSocket for SSH terminal
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${SSH_WS_PORT}/ws/ssh\$1 [P,L]

    # Security headers
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    ErrorLog \${APACHE_LOG_DIR}/${APP_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${APP_NAME}_access.log combined
</VirtualHost>
APACHE

    a2ensite "${APP_NAME}.conf" 2>/dev/null
    a2dissite 000-default.conf 2>/dev/null || true
    apache2ctl configtest && systemctl reload apache2
    success "Apache HTTP vhost configured for ${DOMAIN}"

    # ── Firewall check: certbot needs ports 80 and 443 open ──
    FIREWALL_BLOCKING=false
    FIREWALL_NAME=""

    if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
      FIREWALL_NAME="ufw"
      # Check if 80 and 443 are allowed
      if ! ufw status | grep -qE "80(/tcp)?\s+ALLOW" || ! ufw status | grep -qE "443(/tcp)?\s+ALLOW"; then
        FIREWALL_BLOCKING=true
      fi
    elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q "running"; then
      FIREWALL_NAME="firewalld"
      if ! firewall-cmd --list-ports 2>/dev/null | grep -qE "(80|http)" && \
         ! firewall-cmd --list-services 2>/dev/null | grep -q "http"; then
        FIREWALL_BLOCKING=true
      fi
    elif command -v iptables &>/dev/null; then
      # Only flag if iptables has a DROP/REJECT policy or explicit drop rules for 80/443
      if iptables -L INPUT -n 2>/dev/null | grep -qi "DROP\|REJECT"; then
        # Check if 80/443 are explicitly allowed
        if ! iptables -L INPUT -n 2>/dev/null | grep -qE "dpt:(80|443)\s.*ACCEPT"; then
          FIREWALL_NAME="iptables"
          FIREWALL_BLOCKING=true
        fi
      fi
    fi

    if $FIREWALL_BLOCKING; then
      echo ""
      warn "Firewall detected (${FIREWALL_NAME}) — ports 80 and 443 may be blocked."
      warn "Certbot needs both ports open to verify your domain."
      echo ""
      if [[ "$FIREWALL_NAME" == "ufw" ]]; then
        echo "  Fix with:  ufw allow 80/tcp && ufw allow 443/tcp"
      elif [[ "$FIREWALL_NAME" == "firewalld" ]]; then
        echo "  Fix with:  firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload"
      elif [[ "$FIREWALL_NAME" == "iptables" ]]; then
        echo "  Fix with:  iptables -I INPUT -p tcp --dport 80 -j ACCEPT && iptables -I INPUT -p tcp --dport 443 -j ACCEPT"
      fi
      echo ""
      read -rp "  Continue anyway? [y/N] " FW_CONTINUE < /dev/tty
      if [[ ! "$FW_CONTINUE" =~ ^[Yy]$ ]]; then
        warn "Skipping SSL setup. Open the firewall ports and re-run, or run manually:"
        warn "  certbot --apache -d ${DOMAIN}"
        # Skip certbot but don't exit — the rest of the install is still valid
        SKIP_CERTBOT=true
      fi
    fi

    # Install certbot and obtain SSL certificate
    if [[ "${SKIP_CERTBOT:-false}" != "true" ]]; then
    log "Setting up SSL certificate with Let's Encrypt..."

    if ! command -v certbot &>/dev/null; then
      log "Installing certbot..."
      apt-get install -y -qq certbot python3-certbot-apache
    fi

    CERTBOT_EMAIL_FLAG=""
    if [[ -n "${ADMIN_EMAIL:-}" ]]; then
      CERTBOT_EMAIL_FLAG="--email ${ADMIN_EMAIL}"
    else
      CERTBOT_EMAIL_FLAG="--register-unsafely-without-email"
    fi

    if certbot --apache \
      --non-interactive \
      --agree-tos \
      ${CERTBOT_EMAIL_FLAG} \
      -d "${DOMAIN}" \
      --redirect; then

      success "SSL certificate obtained and configured for ${DOMAIN}"

      # Certbot creates the SSL vhost automatically. Patch it to include
      # WebSocket proxy rules if certbot didn't copy them.
      SSL_VHOST="/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf"
      if [[ -f "$SSL_VHOST" ]]; then
        if ! grep -q "ws://127.0.0.1:${SSH_WS_PORT}" "$SSL_VHOST"; then
          sed -i "/<\/VirtualHost>/i\\
    # WebSocket for SSH terminal\\
    RewriteEngine On\\
    RewriteCond %{HTTP:Upgrade} websocket [NC]\\
    RewriteCond %{HTTP:Connection} upgrade [NC]\\
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${SSH_WS_PORT}/ws/ssh\$1 [P,L]" "$SSL_VHOST"
          apache2ctl configtest && systemctl reload apache2
          success "WebSocket proxy added to SSL vhost"
        fi
      fi

      # Enable auto-renewal timer
      systemctl enable --now certbot.timer 2>/dev/null || true
      success "Certbot auto-renewal enabled"
    else
      warn "SSL certificate failed — site is accessible via HTTP only"
      warn "Retry manually: certbot --apache -d ${DOMAIN}"
    fi

    fi  # end SKIP_CERTBOT check

  else
    # ── Localhost mode: simple reverse proxy, no SSL ──

    cat > "/etc/apache2/sites-available/${APP_NAME}.conf" <<APACHE
<VirtualHost *:80>
    ServerName localhost
    ServerAdmin webmaster@localhost

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${APP_PORT}/
    ProxyPassReverse / http://127.0.0.1:${APP_PORT}/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${SSH_WS_PORT}/ws/ssh\$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/${APP_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${APP_NAME}_access.log combined
</VirtualHost>
APACHE

    a2ensite "${APP_NAME}.conf" 2>/dev/null
    a2dissite 000-default.conf 2>/dev/null || true
    apache2ctl configtest && systemctl reload apache2
    success "Apache configured for localhost (no SSL)"
  fi
fi

# ── Step 8: Start service ───────────────────────────────────────────────────

log "Starting service..."
systemctl start "$SERVICE_NAME"

# Wait for the app to start
sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
  success "Service is running"
else
  warn "Service may not have started correctly. Check: journalctl -u ${SERVICE_NAME} -f"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  GPU Cloud Dashboard installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  App URL:       ${APP_URL}"
echo "  Install dir:   ${INSTALL_DIR}"
echo "  Config:        ${INSTALL_DIR}/.env.local"
echo "  Service:       systemctl status ${SERVICE_NAME}"
echo "  Logs:          journalctl -u ${SERVICE_NAME} -f"
echo ""
echo "  Next steps:"
echo "    1. Visit ${APP_URL}/admin/login"
echo "    2. Enter your email — first login auto-creates the admin account"
echo "    3. Go to Platform Settings to configure integrations"
echo ""
echo "  To change domain, ports, or SSL later:"
echo "    sudo bash reconfigure.sh"
echo ""
if [[ -n "$DOMAIN" ]]; then
  echo "  SSL certificate auto-renews via certbot."
  echo "  Test renewal: certbot renew --dry-run"
  echo ""
fi
