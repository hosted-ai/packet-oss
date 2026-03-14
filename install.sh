#!/usr/bin/env bash
# =============================================================================
# Packet.ai OSS — Install Script
# =============================================================================
# Installs the Packet.ai GPU Cloud Dashboard on a fresh Linux server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/discod/packet-oss/main/install.sh | bash
#   HOSTEDAI_API_URL=http://localhost:5000 bash install.sh   # Non-interactive
#   bash install.sh --docker                                  # Docker mode
#   bash install.sh --skip-apache                             # Skip Apache setup
#
# Supports:
#   - Same-node as HAI (recommended): HOSTEDAI_API_URL=http://localhost:<port>
#   - Separate server: HOSTEDAI_API_URL=https://hai-server.example.com
#   - Docker: install.sh --docker
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
REPO_URL="https://github.com/discod/packet-oss.git"
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

# ── Parse args ───────────────────────────────────────────────────────────────

DOCKER_MODE=false
SKIP_APACHE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)       DOCKER_MODE=true; shift ;;
    --skip-apache)  SKIP_APACHE=true; shift ;;
    --branch)       BRANCH="$2"; shift 2 ;;
    --domain)       DOMAIN="$2"; shift 2 ;;
    *)              shift ;;
  esac
done

# ── Docker mode ──────────────────────────────────────────────────────────────

if $DOCKER_MODE; then
  log "Docker installation mode"

  if ! command -v docker &>/dev/null; then
    fail "Docker is not installed. Install it first: https://docs.docker.com/engine/install/"
  fi
  if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
    fail "Docker Compose is not installed."
  fi

  log "Cloning repository..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    if [[ -d "$INSTALL_DIR" ]]; then
      log "Directory exists, pulling latest..."
      cd "$INSTALL_DIR" && git pull origin "$BRANCH"
    else
      fail "Failed to clone repository"
    fi
  }

  cd "$INSTALL_DIR"

  if [[ ! -f .env.local ]]; then
    cp .env.example .env.local
    log "Created .env.local from .env.example"
    warn "Edit .env.local with your settings, then run: docker-compose up -d"
  else
    log ".env.local already exists"
  fi

  success "Docker setup complete!"
  echo ""
  log "Next steps:"
  echo "  1. Edit ${INSTALL_DIR}/.env.local with your configuration"
  echo "  2. Run: cd ${INSTALL_DIR} && docker-compose up -d"
  echo "  3. Visit http://localhost:3000/admin/login to create your admin account"
  echo ""
  exit 0
fi

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

# Check Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Install Node.js 18+ first:
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
  fail "Node.js 18+ required (found v${NODE_VERSION})"
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
  read -rp "  Domain: " DOMAIN
fi

# hosted.ai API
if [[ -z "${HOSTEDAI_API_URL:-}" ]]; then
  echo ""
  echo "  hosted.ai API URL:"
  echo "    - Same server:    http://localhost:5000 (recommended)"
  echo "    - Remote server:  https://hai-server.example.com"
  echo ""
  read -rp "  HOSTEDAI_API_URL: " HOSTEDAI_API_URL
fi

if [[ -z "${HOSTEDAI_API_KEY:-}" ]]; then
  read -rp "  HOSTEDAI_API_KEY (leave blank to configure later in admin UI): " HOSTEDAI_API_KEY
fi

# Stripe (optional)
if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  read -rp "  STRIPE_SECRET_KEY (optional, press Enter to skip): " STRIPE_SECRET_KEY
fi

# Admin email (optional — for certbot and first admin bootstrap)
if [[ -z "${ADMIN_EMAIL:-}" ]]; then
  read -rp "  Admin email (for SSL certificate and first login): " ADMIN_EMAIL
fi

# Generate secrets
ADMIN_JWT_SECRET=$(openssl rand -hex 32)
CUSTOMER_JWT_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)

# Database password
DB_PASSWORD=$(openssl rand -hex 16)

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

$DB_CLIENT -u root <<EOF
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOF

success "Database '${DB_NAME}' ready"

# ── Step 3: Clone/install application ────────────────────────────────────────

log "Installing application to ${INSTALL_DIR}..."

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Existing installation found, pulling latest..."
  cd "$INSTALL_DIR"
  sudo -u "$APP_USER" git pull origin "$BRANCH" 2>/dev/null || git pull origin "$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  chown -R "${APP_USER}:${APP_USER}" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
success "Application installed"

# ── Step 4: Create .env.local ────────────────────────────────────────────────

log "Writing configuration..."

cat > "${INSTALL_DIR}/.env.local" <<EOF
# Packet.ai OSS — Generated by install.sh on $(date -Iseconds)
NEXT_PUBLIC_EDITION=oss
NEXT_PUBLIC_APP_URL=${APP_URL}

# Database
DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}"

# Auth secrets (auto-generated)
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
CUSTOMER_JWT_SECRET=${CUSTOMER_JWT_SECRET}
CRON_SECRET=${CRON_SECRET}

# hosted.ai
HOSTEDAI_API_URL=${HOSTEDAI_API_URL:-}
HOSTEDAI_API_KEY=${HOSTEDAI_API_KEY:-}

# Stripe (optional — configure in admin UI if not set here)
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY:-}

# SSH WebSocket
SSH_WS_PORT=${SSH_WS_PORT}
EOF

chown "${APP_USER}:${APP_USER}" "${INSTALL_DIR}/.env.local"
chmod 600 "${INSTALL_DIR}/.env.local"
success "Configuration written to .env.local"

# ── Step 5: Install dependencies & build ─────────────────────────────────────

log "Installing dependencies..."
cd "$INSTALL_DIR"
sudo -u "$APP_USER" pnpm install --frozen-lockfile 2>/dev/null || sudo -u "$APP_USER" pnpm install
success "Dependencies installed"

log "Running database migrations..."
sudo -u "$APP_USER" npx prisma migrate deploy 2>/dev/null || sudo -u "$APP_USER" npx prisma db push
success "Database migrated"

log "Building application (this may take a few minutes)..."
sudo -u "$APP_USER" pnpm build
success "Application built"

# ── Step 6: Create systemd service ──────────────────────────────────────────

log "Creating systemd service..."

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Packet.ai OSS Dashboard
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(which node) node_modules/.bin/next start -H 127.0.0.1 -p ${APP_PORT}
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

    # Install certbot and obtain SSL certificate
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

    certbot --apache \
      --non-interactive \
      --agree-tos \
      ${CERTBOT_EMAIL_FLAG} \
      -d "${DOMAIN}" \
      --redirect

    if [[ $? -eq 0 ]]; then
      success "SSL certificate obtained and configured for ${DOMAIN}"

      # Certbot creates the SSL vhost automatically. Patch it to include
      # WebSocket proxy rules (certbot copies the HTTP vhost but we need
      # to ensure the WS rewrite is in the SSL vhost too).
      SSL_VHOST="/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf"
      if [[ -f "$SSL_VHOST" ]]; then
        # Add WebSocket rules if certbot didn't copy them
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
echo -e "${GREEN}  Packet.ai OSS Dashboard installed successfully!${NC}"
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
if [[ -n "$DOMAIN" ]]; then
  echo "  SSL certificate auto-renews via certbot."
  echo "  Test renewal: certbot renew --dry-run"
  echo ""
fi
