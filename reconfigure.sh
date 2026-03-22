#!/usr/bin/env bash
# =============================================================================
# GPU Cloud Dashboard — Reconfigure Script
# =============================================================================
# Post-install configuration tool. Change domain, ports, SSL, HAI backend URLs,
# and run health diagnostics — all from one script.
#
# Usage:
#   sudo bash reconfigure.sh                        # Interactive menu
#   sudo bash reconfigure.sh --show                 # Show current config
#   sudo bash reconfigure.sh --check                # Run health diagnostics
#   sudo bash reconfigure.sh --domain new.example.com
#   sudo bash reconfigure.sh --port 3001
#   sudo bash reconfigure.sh --hai-url http://new-server:8055
#   sudo bash reconfigure.sh --hai-admin-url http://new-server:8999
#   sudo bash reconfigure.sh --ssl-on               # Enable SSL via certbot
#   sudo bash reconfigure.sh --ssl-off              # Disable SSL
#   sudo bash reconfigure.sh --ssl-renew            # Force cert renewal
#   sudo bash reconfigure.sh --reset-password <email> # Reset admin password
#   sudo bash reconfigure.sh --dry-run --domain x   # Preview changes
# =============================================================================

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────

APP_NAME="packet-oss"
INSTALL_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
APP_USER="${APP_NAME}"
ENV_FILE="${INSTALL_DIR}/.env.local"
APACHE_CONF="/etc/apache2/sites-available/${APP_NAME}.conf"
APACHE_SSL_CONF="/etc/apache2/sites-available/${APP_NAME}-le-ssl.conf"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
BACKUP_DIR="${INSTALL_DIR}/backups/reconfigure"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()     { echo -e "${CYAN}[reconfigure]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
fail()    { echo -e "${RED}✗ $1${NC}"; exit 1; }
info()    { echo -e "  ${DIM}$1${NC}"; }

# Run a command with an elapsed-time spinner
run_with_progress() {
  local msg="$1"; shift
  local start=$SECONDS
  local pid logfile="/tmp/packet-oss-reconfig-$$.log"

  "$@" > "$logfile" 2>&1 &
  pid=$!

  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    local elapsed=$(( SECONDS - start ))
    local mins=$(( elapsed / 60 ))
    local secs=$(( elapsed % 60 ))
    printf "\r  ${CYAN}%s${NC} %s ${YELLOW}[%d:%02d]${NC} " "${spin:i++%${#spin}:1}" "$msg" "$mins" "$secs"
    sleep 0.2
  done

  wait "$pid"
  local exit_code=$?
  local elapsed=$(( SECONDS - start ))
  local mins=$(( elapsed / 60 ))
  local secs=$(( elapsed % 60 ))

  printf "\r%-80s\r" ""

  if [[ $exit_code -eq 0 ]]; then
    success "$msg ${YELLOW}[${mins}m ${secs}s]${NC}"
  else
    echo ""
    warn "$msg failed after ${mins}m ${secs}s. Log: $logfile"
    echo -e "${RED}Last 20 lines:${NC}"
    tail -20 "$logfile"
    return $exit_code
  fi

  rm -f "$logfile"
  return $exit_code
}

# ── Config reader ────────────────────────────────────────────────────────────

# Get a value from .env.local
get_env() {
  if [[ -f "$ENV_FILE" ]]; then
    grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | sed "s/^${1}=//" | tr -d '"' || true
  fi
}

# Get current domain from NEXT_PUBLIC_APP_URL
get_current_domain() {
  local url
  url=$(get_env NEXT_PUBLIC_APP_URL)
  echo "$url" | sed 's|https://||' | sed 's|http://||' | cut -d: -f1 | cut -d/ -f1
}

# Get current app port from systemd unit
get_current_port() {
  if [[ -f "$SYSTEMD_UNIT" ]]; then
    grep -oP '(?<=-p )\d+' "$SYSTEMD_UNIT" 2>/dev/null | head -1 || echo "3000"
  else
    echo "3000"
  fi
}

# Get current SSH WS port from .env.local
get_current_ws_port() {
  get_env SSH_WS_PORT || echo "3002"
}

# Check if SSL is active
is_ssl_active() {
  [[ -f "$APACHE_SSL_CONF" ]] && grep -q "SSLEngine" "$APACHE_SSL_CONF" 2>/dev/null
}

# Get SSL expiry date for current domain
get_ssl_expiry() {
  local domain
  domain=$(get_current_domain)
  if [[ -n "$domain" ]] && [[ "$domain" != "localhost" ]] && command -v certbot &>/dev/null; then
    certbot certificates -d "$domain" 2>/dev/null | grep "Expiry Date:" | sed 's/.*Expiry Date: //' | cut -d' ' -f1 || echo "unknown"
  else
    echo "N/A"
  fi
}

# ── Backup & restore ────────────────────────────────────────────────────────

BACKUP_TIMESTAMP=""

create_backup() {
  BACKUP_TIMESTAMP=$(date +%Y%m%d%H%M%S)
  local bdir="${BACKUP_DIR}/${BACKUP_TIMESTAMP}"
  mkdir -p "$bdir"

  [[ -f "$ENV_FILE" ]] && cp "$ENV_FILE" "$bdir/env.local"
  [[ -f "$APACHE_CONF" ]] && cp "$APACHE_CONF" "$bdir/apache.conf"
  [[ -f "$APACHE_SSL_CONF" ]] && cp "$APACHE_SSL_CONF" "$bdir/apache-ssl.conf"
  [[ -f "$SYSTEMD_UNIT" ]] && cp "$SYSTEMD_UNIT" "$bdir/systemd.service"

  # Secure the backup (contains secrets)
  chmod -R 600 "$bdir"
  chmod 700 "$bdir"

  success "Backup created: backups/reconfigure/${BACKUP_TIMESTAMP}"
}

restore_backup() {
  if [[ -z "$BACKUP_TIMESTAMP" ]]; then
    warn "No backup to restore"
    return 1
  fi

  local bdir="${BACKUP_DIR}/${BACKUP_TIMESTAMP}"
  log "Restoring from backup..."

  [[ -f "$bdir/env.local" ]] && cp "$bdir/env.local" "$ENV_FILE"
  [[ -f "$bdir/apache.conf" ]] && cp "$bdir/apache.conf" "$APACHE_CONF"
  [[ -f "$bdir/apache-ssl.conf" ]] && cp "$bdir/apache-ssl.conf" "$APACHE_SSL_CONF"
  [[ -f "$bdir/systemd.service" ]] && cp "$bdir/systemd.service" "$SYSTEMD_UNIT"

  systemctl daemon-reload
  apache2ctl configtest 2>/dev/null && systemctl reload apache2 2>/dev/null || true
  systemctl restart "$SERVICE_NAME" 2>/dev/null || true

  success "Backup restored"
}

# ── .env.local updater ───────────────────────────────────────────────────────

# Update a key in .env.local (or add it if missing)
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# ── Parse args ───────────────────────────────────────────────────────────────

ARG_DOMAIN=""
ARG_PORT=""
ARG_HAI_URL=""
ARG_HAI_ADMIN_URL=""
ARG_SSL_ON=false
ARG_SSL_OFF=false
ARG_SSL_RENEW=false
ARG_SHOW=false
ARG_CHECK=false
ARG_RESET_PASSWORD=""
ARG_DRY_RUN=false
HAS_FLAGS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)         ARG_DOMAIN="$2"; HAS_FLAGS=true; shift 2 ;;
    --port)           ARG_PORT="$2"; HAS_FLAGS=true; shift 2 ;;
    --hai-url)        ARG_HAI_URL="$2"; HAS_FLAGS=true; shift 2 ;;
    --hai-admin-url)  ARG_HAI_ADMIN_URL="$2"; HAS_FLAGS=true; shift 2 ;;
    --ssl-on)         ARG_SSL_ON=true; HAS_FLAGS=true; shift ;;
    --ssl-off)        ARG_SSL_OFF=true; HAS_FLAGS=true; shift ;;
    --ssl-renew)      ARG_SSL_RENEW=true; HAS_FLAGS=true; shift ;;
    --reset-password) ARG_RESET_PASSWORD="$2"; HAS_FLAGS=true; shift 2 ;;
    --show)           ARG_SHOW=true; HAS_FLAGS=true; shift ;;
    --check)          ARG_CHECK=true; HAS_FLAGS=true; shift ;;
    --dry-run)        ARG_DRY_RUN=true; shift ;;
    *)                shift ;;
  esac
done

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  fail "This script must be run as root (or with sudo)"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  fail "No .env.local found at ${ENV_FILE}. Run install.sh first."
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  fail "Installation not found at ${INSTALL_DIR}. Run install.sh first."
fi

# ── --show: Display current configuration ────────────────────────────────────

show_config() {
  local domain port ws_port app_url hai_url hai_admin_url ssl_status ssl_expiry svc_status

  domain=$(get_current_domain)
  port=$(get_current_port)
  ws_port=$(get_current_ws_port)
  app_url=$(get_env NEXT_PUBLIC_APP_URL)
  hai_url=$(get_env HOSTEDAI_API_URL)
  hai_admin_url=$(get_env GPUAAS_ADMIN_URL)

  if is_ssl_active; then
    ssl_status="${GREEN}Active${NC}"
    ssl_expiry=$(get_ssl_expiry)
    if [[ "$ssl_expiry" != "N/A" ]] && [[ "$ssl_expiry" != "unknown" ]]; then
      ssl_status="${ssl_status} (expires ${ssl_expiry})"
    fi
  else
    ssl_status="${YELLOW}Inactive (HTTP only)${NC}"
  fi

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    svc_status="${GREEN}Running${NC}"
  else
    svc_status="${RED}Stopped${NC}"
  fi

  echo ""
  echo -e "  ${BOLD}GPU Cloud Dashboard — Current Configuration${NC}"
  echo ""
  echo -e "  ${BOLD}Domain:${NC}          ${domain:-localhost}"
  echo -e "  ${BOLD}App URL:${NC}         ${app_url:-not set}"
  echo -e "  ${BOLD}App Port:${NC}        ${port}"
  echo -e "  ${BOLD}SSH WS Port:${NC}     ${ws_port}"
  echo -e "  ${BOLD}SSL:${NC}             ${ssl_status}"
  echo ""
  echo -e "  ${BOLD}HAI User API:${NC}    ${hai_url:-not configured}"
  echo -e "  ${BOLD}HAI Admin API:${NC}   ${hai_admin_url:-not configured}"
  echo ""
  echo -e "  ${BOLD}Service:${NC}         ${svc_status}"
  echo -e "  ${BOLD}Install Dir:${NC}     ${INSTALL_DIR}"

  # Apache status
  if command -v apache2ctl &>/dev/null; then
    if [[ -f "$APACHE_CONF" ]]; then
      echo -e "  ${BOLD}Apache:${NC}          ${GREEN}Configured${NC} (${APACHE_CONF})"
    else
      echo -e "  ${BOLD}Apache:${NC}          ${YELLOW}Not configured${NC}"
    fi
  else
    echo -e "  ${BOLD}Apache:${NC}          ${DIM}Not installed${NC}"
  fi

  # DB status
  local db_url
  db_url=$(get_env DATABASE_URL)
  if [[ -n "$db_url" ]]; then
    local db_name
    db_name=$(echo "$db_url" | rev | cut -d/ -f1 | rev)
    echo -e "  ${BOLD}Database:${NC}        ${db_name}"
  fi

  echo ""
}

# ── --check: Health diagnostics ──────────────────────────────────────────────

run_check() {
  local domain app_url pass=0 total=0

  domain=$(get_current_domain)
  app_url=$(get_env NEXT_PUBLIC_APP_URL)

  echo ""
  echo -e "  ${BOLD}GPU Cloud Dashboard — Health Check${NC}"
  echo ""

  # 1. Service status
  total=$((total + 1))
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo -e "  ${GREEN}PASS${NC}  Service '${SERVICE_NAME}' is running"
    pass=$((pass + 1))
  else
    echo -e "  ${RED}FAIL${NC}  Service '${SERVICE_NAME}' is not running"
    info "Fix: systemctl start ${SERVICE_NAME}"
    info "Logs: journalctl -u ${SERVICE_NAME} -f"
  fi

  # 2. Apache config
  if command -v apache2ctl &>/dev/null; then
    total=$((total + 1))
    if apache2ctl configtest 2>/dev/null; then
      echo -e "  ${GREEN}PASS${NC}  Apache configuration is valid"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}FAIL${NC}  Apache configuration has errors"
      info "Fix: apache2ctl configtest (see error output)"
    fi
  fi

  # 3. DNS resolution
  if [[ -n "$domain" ]] && [[ "$domain" != "localhost" ]]; then
    total=$((total + 1))
    if command -v dig &>/dev/null; then
      local resolved
      resolved=$(dig +short "$domain" 2>/dev/null | head -1)
      if [[ -n "$resolved" ]]; then
        echo -e "  ${GREEN}PASS${NC}  DNS resolves: ${domain} → ${resolved}"
        pass=$((pass + 1))
      else
        echo -e "  ${RED}FAIL${NC}  DNS does not resolve: ${domain}"
        info "Check your DNS settings or try: dig ${domain}"
      fi
    elif command -v host &>/dev/null; then
      if host "$domain" &>/dev/null; then
        echo -e "  ${GREEN}PASS${NC}  DNS resolves: ${domain}"
        pass=$((pass + 1))
      else
        echo -e "  ${RED}FAIL${NC}  DNS does not resolve: ${domain}"
      fi
    else
      echo -e "  ${YELLOW}SKIP${NC}  DNS check (dig/host not installed)"
    fi
  fi

  # 4. SSL certificate
  if is_ssl_active; then
    total=$((total + 1))
    local expiry
    expiry=$(get_ssl_expiry)
    if [[ "$expiry" != "N/A" ]] && [[ "$expiry" != "unknown" ]]; then
      # Check if expiring within 7 days
      local expiry_epoch now_epoch
      expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || echo "0")
      now_epoch=$(date +%s)
      local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))
      if [[ $days_left -gt 7 ]]; then
        echo -e "  ${GREEN}PASS${NC}  SSL certificate valid (expires in ${days_left} days)"
        pass=$((pass + 1))
      elif [[ $days_left -gt 0 ]]; then
        echo -e "  ${YELLOW}WARN${NC}  SSL certificate expiring soon (${days_left} days)"
        info "Fix: sudo bash reconfigure.sh --ssl-renew"
      else
        echo -e "  ${RED}FAIL${NC}  SSL certificate expired"
        info "Fix: sudo bash reconfigure.sh --ssl-renew"
      fi
    else
      echo -e "  ${YELLOW}SKIP${NC}  Could not determine SSL expiry"
    fi
  fi

  # 5. App HTTP response
  if [[ -n "$app_url" ]]; then
    total=$((total + 1))
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${app_url}" 2>/dev/null || echo "000")
    if [[ "$http_code" =~ ^(200|301|302|307|308)$ ]]; then
      echo -e "  ${GREEN}PASS${NC}  App responds at ${app_url} (HTTP ${http_code})"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}FAIL${NC}  App not reachable at ${app_url} (HTTP ${http_code})"
      info "Check service logs: journalctl -u ${SERVICE_NAME} -f"
    fi
  fi

  # 6. Database connection
  total=$((total + 1))
  local db_url
  db_url=$(get_env DATABASE_URL)
  if [[ "$db_url" == mysql://* ]]; then
    local db_user db_pass db_host db_port db_name
    db_user=$(echo "$db_url" | sed 's|mysql://||' | cut -d: -f1)
    db_pass=$(echo "$db_url" | sed 's|mysql://||' | cut -d: -f2 | cut -d@ -f1)
    db_host=$(echo "$db_url" | cut -d@ -f2 | cut -d: -f1)
    db_port=$(echo "$db_url" | cut -d@ -f2 | cut -d: -f2 | cut -d/ -f1)
    db_name=$(echo "$db_url" | rev | cut -d/ -f1 | rev)

    DB_CLIENT="mariadb"
    command -v mariadb &>/dev/null || DB_CLIENT="mysql"

    if $DB_CLIENT -u "$db_user" -p"$db_pass" -h "$db_host" -P "$db_port" "$db_name" -e "SELECT 1" &>/dev/null; then
      echo -e "  ${GREEN}PASS${NC}  Database connection OK (${db_name})"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}FAIL${NC}  Database connection failed"
      info "Check DATABASE_URL in ${ENV_FILE}"
    fi
  else
    echo -e "  ${YELLOW}SKIP${NC}  Could not parse DATABASE_URL"
  fi

  # 7. HAI backend reachability
  local hai_url
  hai_url=$(get_env HOSTEDAI_API_URL)
  if [[ -n "$hai_url" ]]; then
    total=$((total + 1))
    local hai_code
    hai_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${hai_url}" 2>/dev/null || echo "000")
    if [[ "$hai_code" != "000" ]]; then
      echo -e "  ${GREEN}PASS${NC}  HAI User Panel reachable (HTTP ${hai_code})"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}FAIL${NC}  HAI User Panel unreachable at ${hai_url}"
      info "Check if the HostedAI User Panel is running"
    fi
  else
    echo -e "  ${DIM}  N/A${NC}   HAI User Panel not configured"
  fi

  local hai_admin_url
  hai_admin_url=$(get_env GPUAAS_ADMIN_URL)
  if [[ -n "$hai_admin_url" ]]; then
    total=$((total + 1))
    local hai_admin_code
    hai_admin_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${hai_admin_url}" 2>/dev/null || echo "000")
    if [[ "$hai_admin_code" != "000" ]]; then
      echo -e "  ${GREEN}PASS${NC}  HAI Admin Panel reachable (HTTP ${hai_admin_code})"
      pass=$((pass + 1))
    else
      echo -e "  ${RED}FAIL${NC}  HAI Admin Panel unreachable at ${hai_admin_url}"
      info "Check if the HostedAI Admin Panel is running"
    fi
  else
    echo -e "  ${DIM}  N/A${NC}   HAI Admin Panel not configured"
  fi

  # Summary
  echo ""
  if [[ $pass -eq $total ]]; then
    echo -e "  ${GREEN}${BOLD}All checks passed (${pass}/${total})${NC}"
  else
    echo -e "  ${YELLOW}${BOLD}${pass}/${total} checks passed${NC}"
  fi
  echo ""
}

# ── Domain change ────────────────────────────────────────────────────────────

change_domain() {
  local new_domain="$1"
  local current_domain
  current_domain=$(get_current_domain)
  local port
  port=$(get_current_port)
  local ws_port
  ws_port=$(get_current_ws_port)

  if [[ "$new_domain" == "$current_domain" ]]; then
    success "Domain is already set to '${new_domain}' — nothing to change"
    return 0
  fi

  # Determine new app URL
  local new_app_url
  if [[ -z "$new_domain" ]] || [[ "$new_domain" == "localhost" ]]; then
    new_app_url="http://localhost:${port}"
  else
    new_app_url="https://${new_domain}"
  fi

  log "Changing domain: ${current_domain:-localhost} → ${new_domain:-localhost}"

  if $ARG_DRY_RUN; then
    echo ""
    echo -e "  ${BOLD}Dry run — changes that would be applied:${NC}"
    echo ""
    echo -e "  ${CYAN}.env.local:${NC}"
    echo -e "    NEXT_PUBLIC_APP_URL: $(get_env NEXT_PUBLIC_APP_URL) → ${new_app_url}"
    echo ""
    if command -v apache2ctl &>/dev/null; then
      echo -e "  ${CYAN}Apache:${NC}"
      echo "    ServerName: ${current_domain:-localhost} → ${new_domain:-localhost}"
      if [[ -n "$new_domain" ]] && [[ "$new_domain" != "localhost" ]]; then
        echo "    SSL: certbot will obtain certificate for ${new_domain}"
      fi
    fi
    echo ""
    echo -e "  ${CYAN}Rebuild:${NC} Required (NEXT_PUBLIC_APP_URL is a build-time variable)"
    echo ""
    return 0
  fi

  create_backup

  # 1. Update .env.local
  set_env "NEXT_PUBLIC_APP_URL" "$new_app_url"
  success "Updated NEXT_PUBLIC_APP_URL → ${new_app_url}"

  # 2. Regenerate Apache vhost
  if command -v apache2ctl &>/dev/null; then
    if [[ -n "$new_domain" ]] && [[ "$new_domain" != "localhost" ]]; then
      # Domain mode: HTTP vhost (certbot will create SSL)
      cat > "$APACHE_CONF" <<APACHE
<VirtualHost *:80>
    ServerName ${new_domain}

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${ws_port}/ws/ssh\$1 [P,L]

    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    ErrorLog \${APACHE_LOG_DIR}/${APP_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${APP_NAME}_access.log combined
</VirtualHost>
APACHE

      # Remove old SSL vhost if domain changed
      if [[ -f "$APACHE_SSL_CONF" ]]; then
        a2dissite "${APP_NAME}-le-ssl.conf" 2>/dev/null || true
        rm -f "$APACHE_SSL_CONF"
      fi

      a2ensite "${APP_NAME}.conf" 2>/dev/null
      apache2ctl configtest && systemctl reload apache2
      success "Apache HTTP vhost updated for ${new_domain}"

      # 3. Obtain SSL certificate
      setup_ssl "$new_domain"
    else
      # Localhost mode: simple reverse proxy, no SSL
      cat > "$APACHE_CONF" <<APACHE
<VirtualHost *:80>
    ServerName localhost

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${port}/
    ProxyPassReverse / http://127.0.0.1:${port}/

    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${ws_port}/ws/ssh\$1 [P,L]

    ErrorLog \${APACHE_LOG_DIR}/${APP_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${APP_NAME}_access.log combined
</VirtualHost>
APACHE

      # Remove SSL vhost if switching to localhost
      if [[ -f "$APACHE_SSL_CONF" ]]; then
        a2dissite "${APP_NAME}-le-ssl.conf" 2>/dev/null || true
        rm -f "$APACHE_SSL_CONF"
      fi

      a2ensite "${APP_NAME}.conf" 2>/dev/null
      apache2ctl configtest && systemctl reload apache2
      success "Apache configured for localhost (no SSL)"
    fi
  else
    warn "Apache not installed — skipping vhost update"
    info "If you use a different reverse proxy, update its config manually"
  fi

  # 4. Rebuild (NEXT_PUBLIC_APP_URL is build-time)
  trigger_rebuild
}

# ── Port change ──────────────────────────────────────────────────────────────

change_port() {
  local new_port="$1"
  local current_port
  current_port=$(get_current_port)

  if [[ "$new_port" == "$current_port" ]]; then
    success "Port is already ${new_port} — nothing to change"
    return 0
  fi

  log "Changing app port: ${current_port} → ${new_port}"

  if $ARG_DRY_RUN; then
    echo ""
    echo -e "  ${BOLD}Dry run — changes that would be applied:${NC}"
    echo ""
    echo -e "  ${CYAN}systemd:${NC}"
    echo "    ExecStart port: ${current_port} → ${new_port}"
    if [[ -f "$APACHE_CONF" ]]; then
      echo -e "  ${CYAN}Apache:${NC}"
      echo "    ProxyPass: 127.0.0.1:${current_port} → 127.0.0.1:${new_port}"
    fi
    echo ""
    return 0
  fi

  create_backup

  # 1. Update systemd unit
  if [[ -f "$SYSTEMD_UNIT" ]]; then
    sed -i "s|-p ${current_port}|-p ${new_port}|g" "$SYSTEMD_UNIT"
    systemctl daemon-reload
    success "Updated systemd service port"
  fi

  # 2. Update Apache ProxyPass
  if [[ -f "$APACHE_CONF" ]]; then
    sed -i "s|http://127.0.0.1:${current_port}/|http://127.0.0.1:${new_port}/|g" "$APACHE_CONF"
    if [[ -f "$APACHE_SSL_CONF" ]]; then
      sed -i "s|http://127.0.0.1:${current_port}/|http://127.0.0.1:${new_port}/|g" "$APACHE_SSL_CONF"
    fi
    apache2ctl configtest && systemctl reload apache2
    success "Updated Apache proxy port"
  fi

  # 3. Restart service
  restart_service
}

# ── HAI URL changes ──────────────────────────────────────────────────────────

change_hai_url() {
  local new_url="$1"
  local current_url
  current_url=$(get_env HOSTEDAI_API_URL)

  if [[ "$new_url" == "$current_url" ]]; then
    success "HAI User Panel URL is already '${new_url}'"
    return 0
  fi

  log "Changing HAI User Panel URL: ${current_url:-not set} → ${new_url}"

  if $ARG_DRY_RUN; then
    echo -e "  ${CYAN}.env.local:${NC}"
    echo "    HOSTEDAI_API_URL: ${current_url:-not set} → ${new_url}"
    echo ""
    return 0
  fi

  create_backup
  set_env "HOSTEDAI_API_URL" "$new_url"
  success "Updated HOSTEDAI_API_URL"
  restart_service
}

change_hai_admin_url() {
  local new_url="$1"
  local current_url
  current_url=$(get_env GPUAAS_ADMIN_URL)

  if [[ "$new_url" == "$current_url" ]]; then
    success "HAI Admin Panel URL is already '${new_url}'"
    return 0
  fi

  log "Changing HAI Admin Panel URL: ${current_url:-not set} → ${new_url}"

  if $ARG_DRY_RUN; then
    echo -e "  ${CYAN}.env.local:${NC}"
    echo "    GPUAAS_ADMIN_URL: ${current_url:-not set} → ${new_url}"
    echo ""
    return 0
  fi

  create_backup
  set_env "GPUAAS_ADMIN_URL" "$new_url"
  success "Updated GPUAAS_ADMIN_URL"
  restart_service
}

# ── SSL management ───────────────────────────────────────────────────────────

setup_ssl() {
  local domain="${1:-$(get_current_domain)}"

  if [[ -z "$domain" ]] || [[ "$domain" == "localhost" ]]; then
    warn "SSL requires a domain name. Set a domain first: --domain example.com"
    return 1
  fi

  if ! command -v certbot &>/dev/null; then
    log "Installing certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-apache
  fi

  # Firewall check
  check_firewall

  log "Obtaining SSL certificate for ${domain}..."

  local ws_port
  ws_port=$(get_current_ws_port)

  if certbot --apache \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    -d "${domain}" \
    --redirect 2>/dev/null; then

    success "SSL certificate obtained for ${domain}"

    # Patch SSL vhost with WebSocket rules if missing
    if [[ -f "$APACHE_SSL_CONF" ]]; then
      if ! grep -q "ws://127.0.0.1:${ws_port}" "$APACHE_SSL_CONF"; then
        sed -i "/<\/VirtualHost>/i\\
    # WebSocket for SSH terminal\\
    RewriteEngine On\\
    RewriteCond %{HTTP:Upgrade} websocket [NC]\\
    RewriteCond %{HTTP:Connection} upgrade [NC]\\
    RewriteRule ^/ws/ssh(.*) ws://127.0.0.1:${ws_port}/ws/ssh\$1 [P,L]" "$APACHE_SSL_CONF"
        apache2ctl configtest && systemctl reload apache2
        success "WebSocket proxy added to SSL vhost"
      fi
    fi

    systemctl enable --now certbot.timer 2>/dev/null || true
    success "Certbot auto-renewal enabled"
  else
    warn "SSL certificate failed — site accessible via HTTP only"
    info "Retry manually: certbot --apache -d ${domain}"
  fi
}

disable_ssl() {
  local domain
  domain=$(get_current_domain)

  if [[ ! -f "$APACHE_SSL_CONF" ]]; then
    success "SSL is already disabled"
    return 0
  fi

  log "Disabling SSL..."

  if $ARG_DRY_RUN; then
    echo -e "  ${CYAN}Changes:${NC}"
    echo "    Remove SSL vhost: ${APACHE_SSL_CONF}"
    echo "    Update NEXT_PUBLIC_APP_URL: https:// → http://"
    echo ""
    echo -e "  ${CYAN}Rebuild:${NC} Required"
    return 0
  fi

  create_backup

  a2dissite "${APP_NAME}-le-ssl.conf" 2>/dev/null || true
  rm -f "$APACHE_SSL_CONF"
  apache2ctl configtest && systemctl reload apache2
  success "SSL vhost removed"

  # Update app URL to HTTP
  local port
  port=$(get_current_port)
  if [[ -n "$domain" ]] && [[ "$domain" != "localhost" ]]; then
    set_env "NEXT_PUBLIC_APP_URL" "http://${domain}"
  else
    set_env "NEXT_PUBLIC_APP_URL" "http://localhost:${port}"
  fi
  success "Updated app URL to HTTP"

  trigger_rebuild
}

renew_ssl() {
  local domain
  domain=$(get_current_domain)

  if [[ -z "$domain" ]] || [[ "$domain" == "localhost" ]]; then
    warn "No domain configured — nothing to renew"
    return 1
  fi

  if $ARG_DRY_RUN; then
    echo -e "  Would run: certbot renew --cert-name ${domain} --force-renewal"
    return 0
  fi

  log "Renewing SSL certificate for ${domain}..."
  if certbot renew --cert-name "$domain" --force-renewal 2>/dev/null; then
    success "SSL certificate renewed"
    systemctl reload apache2 2>/dev/null || true
  else
    warn "SSL renewal failed"
    info "Try manually: certbot renew --cert-name ${domain} --force-renewal"
  fi
}

check_firewall() {
  local blocking=false
  local fw_name=""

  if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    fw_name="ufw"
    if ! ufw status | grep -qE "80(/tcp)?\s+ALLOW" || ! ufw status | grep -qE "443(/tcp)?\s+ALLOW"; then
      blocking=true
    fi
  elif command -v firewall-cmd &>/dev/null && firewall-cmd --state 2>/dev/null | grep -q "running"; then
    fw_name="firewalld"
    if ! firewall-cmd --list-services 2>/dev/null | grep -q "http"; then
      blocking=true
    fi
  fi

  if $blocking; then
    warn "Firewall detected (${fw_name}) — ports 80/443 may be blocked."
    info "Certbot needs both ports open for domain verification."
    if [[ "$fw_name" == "ufw" ]]; then
      info "Fix: ufw allow 80/tcp && ufw allow 443/tcp"
    elif [[ "$fw_name" == "firewalld" ]]; then
      info "Fix: firewall-cmd --permanent --add-service=http --add-service=https && firewall-cmd --reload"
    fi
  fi
}

# ── Rebuild & restart helpers ────────────────────────────────────────────────

NEEDS_REBUILD=false

trigger_rebuild() {
  echo ""
  warn "NEXT_PUBLIC_APP_URL changed — a rebuild is required for the new URL to take effect."
  echo ""
  read -rp "  Rebuild now? This takes ~2 minutes. [Y/n] " REBUILD_CONFIRM
  REBUILD_CONFIRM="${REBUILD_CONFIRM:-Y}"

  if [[ "$REBUILD_CONFIRM" =~ ^[Yy]$ ]]; then
    cd "$INSTALL_DIR"
    local env_vars
    env_vars=$(grep -v '^#' "$ENV_FILE" | grep '=' | xargs)

    if run_with_progress "Building application" sudo -u "$APP_USER" bash -c "cd ${INSTALL_DIR} && env ${env_vars} pnpm build"; then
      restart_service
    else
      warn "Build failed!"
      echo ""
      read -rp "  Restore previous configuration? [Y/n] " RESTORE_CONFIRM
      RESTORE_CONFIRM="${RESTORE_CONFIRM:-Y}"
      if [[ "$RESTORE_CONFIRM" =~ ^[Yy]$ ]]; then
        restore_backup
        warn "Previous configuration restored. The app is running with the old settings."
      else
        warn "Config was changed but build failed. Fix the issue and run: cd ${INSTALL_DIR} && pnpm build"
      fi
      return 1
    fi
  else
    warn "Skipping rebuild. The app will use the old URL until you rebuild."
    info "Run manually: cd ${INSTALL_DIR} && sudo -u ${APP_USER} pnpm build"
    info "Then: systemctl restart ${SERVICE_NAME}"
    restart_service
  fi
}

restart_service() {
  log "Restarting service..."
  systemctl restart "$SERVICE_NAME" 2>/dev/null || true
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    success "Service restarted"
  else
    warn "Service may not have started correctly"
    info "Check: journalctl -u ${SERVICE_NAME} -f"
  fi
}

# ── Admin password reset ─────────────────────────────────────────────────────

ADMINS_FILE="${INSTALL_DIR}/data/admins.json"

reset_admin_password() {
  local email="$1"

  if [[ ! -f "$ADMINS_FILE" ]]; then
    fail "No admins file found at ${ADMINS_FILE}. Has the app been set up?"
  fi

  # Check if the email exists in admins.json
  if ! RESET_EMAIL="$email" ADMINS_PATH="$ADMINS_FILE" python3 -c '
import json, os, sys
data = json.load(open(os.environ["ADMINS_PATH"]))
emails = [a["email"].lower() for a in data["admins"]]
if os.environ["RESET_EMAIL"].lower() not in emails:
    sys.exit(1)
' 2>/dev/null; then
    echo ""
    echo -e "${RED}✗ No admin found with email \"${email}\"${NC}"
    echo ""
    echo "  Existing admins:"
    ADMINS_PATH="$ADMINS_FILE" python3 -c '
import json, os
data = json.load(open(os.environ["ADMINS_PATH"]))
for a in data["admins"]:
    print(f"    - {a[\"email\"]}")
'
    exit 1
  fi

  echo ""
  log "Resetting password for: ${email}"
  echo ""

  # Prompt for new password
  read -rsp "  New password (min 8 chars): " NEW_PASS
  echo ""
  if [[ ${#NEW_PASS} -lt 8 ]]; then
    fail "Password must be at least 8 characters"
  fi

  read -rsp "  Confirm password: " CONFIRM_PASS
  echo ""
  if [[ "$NEW_PASS" != "$CONFIRM_PASS" ]]; then
    fail "Passwords do not match"
  fi

  # Hash with scrypt and update admins.json (matches app's auth params)
  RESET_EMAIL="$email" RESET_PASS="$NEW_PASS" ADMINS_PATH="$ADMINS_FILE" \
  python3 -c '
import json, hashlib, os, sys

email = os.environ["RESET_EMAIL"].lower()
password = os.environ["RESET_PASS"]
admins_path = os.environ["ADMINS_PATH"]

# scrypt params matching src/lib/auth/admin.ts
salt = os.urandom(16).hex()
dk = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
password_hash = salt + ":" + dk.hex()

with open(admins_path, "r") as f:
    data = json.load(f)

for admin in data["admins"]:
    if admin["email"].lower() == email:
        admin["passwordHash"] = password_hash
        break

with open(admins_path, "w") as f:
    json.dump(data, f, indent=2)

print("OK")
'

  if [[ $? -eq 0 ]]; then
    echo ""
    success "Password reset for ${email}"
    info "You can now log in at /admin/login"
    echo ""
  else
    fail "Failed to reset password"
  fi
}

# ── Interactive menu ─────────────────────────────────────────────────────────

interactive_menu() {
  show_config

  echo -e "  ${BOLD}What would you like to change?${NC}"
  echo ""
  echo "    1) Domain"
  echo "    2) App port"
  echo "    3) HostedAI backend URLs"
  echo "    4) SSL settings"
  echo "    5) Run health check"
  echo "    6) Reset admin password"
  echo "    q) Quit"
  echo ""
  read -rp "  Choice: " CHOICE

  case "$CHOICE" in
    1)
      echo ""
      echo "  Current domain: $(get_current_domain)"
      echo "  Leave blank for localhost (no SSL)."
      echo ""
      read -rp "  New domain: " NEW_DOMAIN
      if [[ -n "$NEW_DOMAIN" ]]; then
        change_domain "$NEW_DOMAIN"
      else
        change_domain "localhost"
      fi
      ;;
    2)
      echo ""
      echo "  Current port: $(get_current_port)"
      echo ""
      read -rp "  New port: " NEW_PORT
      if [[ -n "$NEW_PORT" ]]; then
        change_port "$NEW_PORT"
      fi
      ;;
    3)
      echo ""
      local current_hai
      current_hai=$(get_env HOSTEDAI_API_URL)
      local current_hai_admin
      current_hai_admin=$(get_env GPUAAS_ADMIN_URL)
      echo "  Current HAI User Panel URL:  ${current_hai:-not set}"
      echo "  Current HAI Admin Panel URL: ${current_hai_admin:-not set}"
      echo ""
      read -rp "  New HAI User Panel URL (Enter to skip): " NEW_HAI
      if [[ -n "$NEW_HAI" ]]; then
        change_hai_url "$NEW_HAI"
      fi
      read -rp "  New HAI Admin Panel URL (Enter to skip): " NEW_HAI_ADMIN
      if [[ -n "$NEW_HAI_ADMIN" ]]; then
        change_hai_admin_url "$NEW_HAI_ADMIN"
      fi
      ;;
    4)
      echo ""
      if is_ssl_active; then
        echo "  SSL is currently ${GREEN}active${NC}"
        echo ""
        echo "    a) Renew certificate"
        echo "    b) Disable SSL (switch to HTTP)"
        echo "    c) Back"
        echo ""
        read -rp "  Choice: " SSL_CHOICE
        case "$SSL_CHOICE" in
          a) renew_ssl ;;
          b) disable_ssl ;;
          *) ;;
        esac
      else
        echo -e "  SSL is currently ${YELLOW}inactive${NC}"
        echo ""
        echo "    a) Enable SSL (requires a domain)"
        echo "    b) Back"
        echo ""
        read -rp "  Choice: " SSL_CHOICE
        case "$SSL_CHOICE" in
          a) setup_ssl ;;
          *) ;;
        esac
      fi
      ;;
    5)
      run_check
      ;;
    6)
      echo ""
      if [[ -f "$ADMINS_FILE" ]]; then
        echo "  Existing admins:"
        ADMINS_PATH="$ADMINS_FILE" python3 -c '
import json, os
data = json.load(open(os.environ["ADMINS_PATH"]))
for a in data["admins"]:
    print(f"    - {a[\"email\"]}")
' 2>/dev/null || echo "    (could not read admins file)"
        echo ""
      fi
      read -rp "  Admin email to reset: " RESET_EMAIL
      if [[ -n "$RESET_EMAIL" ]]; then
        reset_admin_password "$RESET_EMAIL"
      fi
      ;;
    q|Q|"")
      echo "  Bye!"
      ;;
    *)
      warn "Unknown option: $CHOICE"
      ;;
  esac
}

# ── Main dispatch ────────────────────────────────────────────────────────────

# Handle --show
if $ARG_SHOW; then
  show_config
  exit 0
fi

# Handle --check
if $ARG_CHECK; then
  run_check
  exit 0
fi

# Handle --reset-password
if [[ -n "$ARG_RESET_PASSWORD" ]]; then
  reset_admin_password "$ARG_RESET_PASSWORD"
  exit 0
fi

# Handle flag-based operations
if $HAS_FLAGS; then
  if $ARG_DRY_RUN; then
    echo ""
    echo -e "  ${BOLD}DRY RUN — no changes will be made${NC}"
    echo ""
  fi

  [[ -n "$ARG_DOMAIN" ]] && change_domain "$ARG_DOMAIN"
  [[ -n "$ARG_PORT" ]] && change_port "$ARG_PORT"
  [[ -n "$ARG_HAI_URL" ]] && change_hai_url "$ARG_HAI_URL"
  [[ -n "$ARG_HAI_ADMIN_URL" ]] && change_hai_admin_url "$ARG_HAI_ADMIN_URL"
  $ARG_SSL_ON && setup_ssl
  $ARG_SSL_OFF && disable_ssl
  $ARG_SSL_RENEW && renew_ssl

  if ! $ARG_DRY_RUN; then
    echo ""
    success "Reconfiguration complete!"
    echo ""
  fi
  exit 0
fi

# No flags — interactive mode
interactive_menu
