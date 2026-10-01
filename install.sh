#!/usr/bin/env bash
# =============================================================================
#  TPanel installer
#
#    curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash
#    curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash -s -- --port 9443 --php "8.3 8.2"
#
#  VPS đã có MySQL/MariaDB với mật khẩu root:
#    curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash -s -- --mysql-root-password 'xxx'
#
#  Supported: Ubuntu 20.04 / 22.04 / 24.04, Debian 11 / 12 (x86_64, arm64)
#  Re-running the script upgrades TPanel in place (keeps data, admin & DB credentials).
#
#  Existing services are detected and reused, never replaced:
#   - MySQL / MariaDB / Percona already installed (apt or panel-built): reused, TPanel gets its own admin user
#   - nginx from apt: reused, existing vhosts / default site untouched
#   - port 80/443 held by another web server (Apache, OpenLiteSpeed, a panel's nginx): TPanel's nginx is
#     installed but left stopped until you switch over ("coexist mode")
# =============================================================================
set -Eeuo pipefail

# ---- Configurable (env vars or flags) ---------------------------------------
TPANEL_REPO="${TPANEL_REPO:-https://github.com/tampham92/tpanel.git}"
TPANEL_BRANCH="${TPANEL_BRANCH:-main}"
TPANEL_TARBALL="${TPANEL_TARBALL:-}"          # URL .tar.gz thay cho git (tuỳ chọn)
TPANEL_PORT="${TPANEL_PORT:-8686}"
PHP_VERSIONS="${PHP_VERSIONS:-8.3 8.2 8.1 7.4}"
NODE_MAJOR="${NODE_MAJOR:-22}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
FRESH_DATA=0
INSTALL_DIR="/opt/tpanel"
DATA_DIR="/var/lib/tpanel"
CONF_DIR="/etc/tpanel"
ENV_FILE="$CONF_DIR/tpanel.env"
NGINX_BIN="/usr/sbin/nginx"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) TPANEL_PORT="$2"; shift 2 ;;
    --php) PHP_VERSIONS="$2"; shift 2 ;;
    --node) NODE_MAJOR="$2"; shift 2 ;;
    --repo) TPANEL_REPO="$2"; shift 2 ;;
    --branch) TPANEL_BRANCH="$2"; shift 2 ;;
    --tarball) TPANEL_TARBALL="$2"; shift 2 ;;
    --mysql-root-user) MYSQL_ROOT_USER="$2"; shift 2 ;;
    --mysql-root-password) MYSQL_ROOT_PASSWORD="$2"; shift 2 ;;
    --fresh-data) FRESH_DATA=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Tham số không hợp lệ: $1"; exit 1 ;;
  esac
done

# ---- Helpers ----------------------------------------------------------------
c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_blue='\033[0;34m'; c_off='\033[0m'
step() { echo -e "\n${c_blue}==>${c_off} $*"; }
ok()   { echo -e "${c_green}✔${c_off} $*"; }
warn() { echo -e "${c_yellow}!${c_off} $*"; WARNINGS+=("$*"); }
die()  { echo -e "${c_red}✘ $*${c_off}" >&2; exit 1; }
trap 'die "Cài đặt thất bại ở dòng $LINENO (lệnh: $BASH_COMMAND)"' ERR
# `|| true`: with pipefail, tr dies of SIGPIPE once head has enough bytes
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-24}" || true; }
WARNINGS=()
TMP_FILES=()
cleanup() { rm -f ${TMP_FILES[@]+"${TMP_FILES[@]}"} 2>/dev/null || true; restore_policy_rc; }
trap cleanup EXIT

export DEBIAN_FRONTEND=noninteractive
# Lock timeout: fresh VPS images often run unattended-upgrades right after boot.
APT="apt-get -y -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"

pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
any_pkg_installed() { local p; for p in "$@"; do pkg_installed "$p" && return 0; done; return 1; }

# PIDs listening on a TCP port
port_pids() { ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true; }

# "name (/path/to/exe)" of the first listener on a port that is NOT the apt nginx binary
foreign_listener() {
  local pid exe
  for pid in $(port_pids "$1"); do
    exe=$(readlink -f "/proc/$pid/exe" 2>/dev/null || echo "?")
    if [[ "$exe" != "$NGINX_BIN" ]]; then echo "$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ') ($exe)"; return 0; fi
  done
  return 1
}

# Keep services from auto-starting while their package installs (used when ports are taken).
POLICY_BACKUP=""
block_service_start() {
  if [[ -e /usr/sbin/policy-rc.d ]]; then POLICY_BACKUP=$(mktemp); cp -a /usr/sbin/policy-rc.d "$POLICY_BACKUP"; fi
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod +x /usr/sbin/policy-rc.d
}
restore_policy_rc() {
  [[ -f /usr/sbin/policy-rc.d ]] && grep -q 'exit 101' /usr/sbin/policy-rc.d 2>/dev/null && rm -f /usr/sbin/policy-rc.d
  if [[ -n "$POLICY_BACKUP" && -f "$POLICY_BACKUP" ]]; then mv "$POLICY_BACKUP" /usr/sbin/policy-rc.d; POLICY_BACKUP=""; fi
}

# ---- Pre-flight -------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Hãy chạy với quyền root: curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash"
[[ -r /etc/os-release ]] || die "Không xác định được hệ điều hành"
. /etc/os-release
case "$ID:${VERSION_ID:-}" in
  ubuntu:20.04|ubuntu:22.04|ubuntu:24.04|debian:11|debian:12) ;;
  *) warn "HĐH $PRETTY_NAME chưa được kiểm thử chính thức - tiếp tục trên cơ sở Debian/Ubuntu" ;;
esac
command -v apt-get >/dev/null || die "Cần apt-get (Debian/Ubuntu)"
ARCH=$(dpkg --print-architecture)
[[ "$ARCH" == amd64 || "$ARCH" == arm64 ]] || die "Kiến trúc $ARCH không được hỗ trợ"
if [[ -n "$(port_pids "$TPANEL_PORT")" ]] && ! systemctl is-active --quiet tpanel; then
  die "Port $TPANEL_PORT đang được dùng. Chọn port khác: ... | sudo bash -s -- --port 9443"
fi

UPGRADE=0; [[ -f "$ENV_FILE" ]] && UPGRADE=1
# Data from an earlier install without its env file: the env holds TPANEL_SECRET, which decrypts the stored
# DB/SSH credentials, and the admin account already exists - a "fresh" install would silently break both.
if [[ $UPGRADE == 0 && -f "$DATA_DIR/tpanel.db" ]]; then
  if [[ $FRESH_DATA == 1 ]]; then
    mv "$DATA_DIR" "$DATA_DIR.bak-$(date +%Y%m%d%H%M%S)"
    warn "Đã chuyển dữ liệu TPanel cũ sang $DATA_DIR.bak-* và cài mới"
  else
    die "Tìm thấy dữ liệu TPanel cũ ($DATA_DIR) nhưng thiếu $ENV_FILE (chứa khoá giải mã).
   - Khôi phục $ENV_FILE từ bản sao lưu rồi chạy lại installer (giữ nguyên site & tài khoản), hoặc
   - Cài mới, dữ liệu cũ được đổi tên thành bản sao lưu: ... | sudo bash -s -- --fresh-data"
  fi
fi
echo -e "${c_blue}TPanel installer${c_off} - $PRETTY_NAME ($ARCH) - $([[ $UPGRADE == 1 ]] && echo 'NÂNG CẤP' || echo 'CÀI MỚI')"

# ---- Detect what is already on this server -----------------------------------
step "Kiểm tra dịch vụ đang có trên VPS"
NGINX_PREEXISTING=0; pkg_installed nginx-common && NGINX_PREEXISTING=1
WEB_FOREIGN=""
WEB_FOREIGN=$(foreign_listener 80 || foreign_listener 443 || true)
COEXIST=0; [[ -n "$WEB_FOREIGN" ]] && COEXIST=1

DB_PREEXISTING=0
if any_pkg_installed mariadb-server mysql-server mysql-community-server percona-server-server percona-xtradb-cluster-server \
   || [[ -n "$(port_pids 3306)" ]] || pgrep -x 'mysqld|mariadbd' >/dev/null 2>&1; then
  DB_PREEXISTING=1
fi

[[ $NGINX_PREEXISTING == 1 ]] && ok "nginx (apt) đã có - dùng lại, không đụng tới vhost hiện có"
[[ $COEXIST == 1 ]] && warn "Port 80/443 đang do $WEB_FOREIGN giữ → nginx của TPanel sẽ được cài nhưng CHƯA chạy (chế độ cùng tồn tại)"
[[ $DB_PREEXISTING == 1 ]] && ok "MySQL/MariaDB đã có - dùng lại, không cài đè"

# ---- Base packages ----------------------------------------------------------
step "Cài gói hệ thống cơ bản"
$APT update || warn "apt-get update báo lỗi (thường do repo bên thứ ba hỏng) - vẫn tiếp tục"
$APT install curl ca-certificates gnupg git tar gzip pigz rsync unzip openssl lsb-release cron logrotate \
  iproute2 procps sudo apt-transport-https
ok "Gói cơ bản"

# ---- PHP repository (ondrej / sury) -----------------------------------------
step "Thêm kho PHP nhiều phiên bản"
if [[ "$ID" == ubuntu ]]; then
  $APT install software-properties-common
  if ! grep -rqs "ondrej/php" /etc/apt/sources.list.d/; then
    add-apt-repository -y ppa:ondrej/php
  fi
elif ! grep -rqs "packages.sury.org/php" /etc/apt/sources.list.d/ /etc/apt/sources.list; then
  curl -fsSL https://packages.sury.org/php/apt.gpg -o /usr/share/keyrings/php-sury.gpg
  echo "deb [signed-by=/usr/share/keyrings/php-sury.gpg] https://packages.sury.org/php/ $VERSION_CODENAME main" > /etc/apt/sources.list.d/php-sury.list
fi

# ---- Node.js ----------------------------------------------------------------
# Check /usr/bin/node specifically: an nvm install in root's PATH is invisible to the systemd service.
node_major() { [[ -x /usr/bin/node ]] && /usr/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if (( $(node_major) < 20 )); then
  step "Thêm kho Node.js $NODE_MAJOR.x"
  (( $(node_major) > 0 )) && warn "Node.js $(/usr/bin/node -v) trong /usr/bin sẽ được nâng lên $NODE_MAJOR.x (TPanel cần >= 20)"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
fi
$APT update || warn "apt-get update báo lỗi - vẫn tiếp tục"

# ---- Node, certbot ------------------------------------------------------------
step "Cài Node.js, Certbot"
if (( $(node_major) < 20 )); then $APT install nodejs; fi
(( $(node_major) >= 20 )) || die "Không cài được Node.js >= 20 vào /usr/bin/node"
corepack enable >/dev/null 2>&1 || true
pkg_installed certbot || command -v certbot >/dev/null || $APT install certbot
ok "node $(/usr/bin/node -v), $(certbot --version 2>&1 | head -1)"

# ---- MySQL / MariaDB ----------------------------------------------------------
step "MySQL / MariaDB"
if [[ $DB_PREEXISTING == 0 ]]; then
  $APT install mariadb-server mariadb-client
  systemctl enable --now mariadb >/dev/null
  ok "Đã cài MariaDB $(mysql --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
else
  # Never install a second server next to the existing one; only make sure a client exists.
  if ! command -v mysql >/dev/null || ! command -v mysqldump >/dev/null; then
    if any_pkg_installed mysql-server mysql-community-server; then $APT install mysql-client
    elif any_pkg_installed percona-server-server; then $APT install percona-server-client
    else $APT install mariadb-client; fi
  fi
  for svc in mariadb mysql mysqld; do
    if systemctl list-unit-files "$svc.service" >/dev/null 2>&1 && systemctl list-unit-files "$svc.service" | grep -q "$svc"; then
      systemctl is-active --quiet "$svc" || systemctl start "$svc" || true
      break
    fi
  done
fi

# Find a way to log in as an administrator: socket auth, ~/.my.cnf, debian.cnf, or the given password.
MYSQL_ADMIN=()
try_mysql() { "$@" -N -B -e 'SELECT 1' >/dev/null 2>&1; }
if try_mysql mysql -u"$MYSQL_ROOT_USER" && [[ -z "$MYSQL_ROOT_PASSWORD" ]]; then
  MYSQL_ADMIN=(mysql -u"$MYSQL_ROOT_USER")
elif [[ -n "$MYSQL_ROOT_PASSWORD" ]]; then
  ROOT_CNF=$(mktemp); TMP_FILES+=("$ROOT_CNF"); chmod 600 "$ROOT_CNF"
  esc_pw=${MYSQL_ROOT_PASSWORD//\\/\\\\}; esc_pw=${esc_pw//\"/\\\"}   # option-file quoting: \ and "
  printf '[client]\nuser="%s"\npassword="%s"\n' "$MYSQL_ROOT_USER" "$esc_pw" > "$ROOT_CNF"
  try_mysql mysql --defaults-extra-file="$ROOT_CNF" && MYSQL_ADMIN=(mysql --defaults-extra-file="$ROOT_CNF")
  if [[ ${#MYSQL_ADMIN[@]} -eq 0 ]]; then
    printf 'host=127.0.0.1\n' >> "$ROOT_CNF"
    try_mysql mysql --defaults-extra-file="$ROOT_CNF" && MYSQL_ADMIN=(mysql --defaults-extra-file="$ROOT_CNF")
  fi
elif [[ -r /etc/mysql/debian.cnf ]] && try_mysql mysql --defaults-file=/etc/mysql/debian.cnf; then
  MYSQL_ADMIN=(mysql --defaults-file=/etc/mysql/debian.cnf)
fi

MYSQL_ENV_CONN=""
if [[ $UPGRADE == 0 ]]; then
  if [[ ${#MYSQL_ADMIN[@]} -eq 0 ]]; then
    die "Không đăng nhập được MySQL/MariaDB đang có với quyền quản trị.
   Chạy lại kèm mật khẩu root của database:
     curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash -s -- --mysql-root-password 'MẬT_KHẨU'
   (hoặc --mysql-root-user <user> nếu tài khoản quản trị không phải root)"
  fi
  DB_VERSION=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT VERSION()')
  DB_SOCKET=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT @@socket' 2>/dev/null || true)
  DB_PORT=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT @@port' 2>/dev/null || echo 3306)
  MYSQL_PASS=$(rand 32)
  # 'localhost' = socket connections, '127.0.0.1' = TCP; create both so either transport works.
  # Deliberately no hardening statements (DROP DATABASE test, anonymous users...): this may be a live server.
  "${MYSQL_ADMIN[@]}" <<SQL
CREATE USER IF NOT EXISTS 'tpanel'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
ALTER USER 'tpanel'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON *.* TO 'tpanel'@'localhost' WITH GRANT OPTION;
CREATE USER IF NOT EXISTS 'tpanel'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
ALTER USER 'tpanel'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON *.* TO 'tpanel'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
  if [[ -n "$DB_SOCKET" && -S "$DB_SOCKET" ]]; then
    MYSQL_ENV_CONN="TPANEL_MYSQL_SOCKET=$DB_SOCKET"
  else
    MYSQL_ENV_CONN=$'TPANEL_MYSQL_SOCKET=\nTPANEL_MYSQL_HOST=127.0.0.1\nTPANEL_MYSQL_PORT='"$DB_PORT"
  fi
  ok "Tài khoản 'tpanel' trên $DB_VERSION (${DB_SOCKET:-127.0.0.1:$DB_PORT})"
fi

# ---- PHP-FPM ------------------------------------------------------------------
step "Cài PHP-FPM: $PHP_VERSIONS"
for v in $PHP_VERSIONS; do
  fresh=1; pkg_installed "php$v-fpm" && fresh=0
  core=()
  for p in fpm cli mysql curl gd mbstring xml zip intl bcmath opcache; do core+=("php$v-$p"); done
  if $APT install "${core[@]}"; then
    for p in soap imagick redis; do $APT install "php$v-$p" >/dev/null 2>&1 || warn "PHP $v: thiếu extension $p"; done
    # Only tune php.ini on versions we installed - an existing server's settings are left alone.
    if [[ $fresh == 1 ]]; then
      sed -i -E 's/^;?upload_max_filesize.*/upload_max_filesize = 256M/; s/^;?post_max_size.*/post_max_size = 256M/; s/^;?memory_limit.*/memory_limit = 512M/; s/^;?max_execution_time.*/max_execution_time = 300/' "/etc/php/$v/fpm/php.ini"
    fi
    systemctl enable --now "php$v-fpm" >/dev/null || warn "Không khởi động được php$v-fpm"
    ok "PHP $v$([[ $fresh == 0 ]] && echo ' (đã có)')"
  else
    warn "Không cài được PHP $v - bỏ qua"
  fi
done

step "Cài WP-CLI"
if ! command -v wp >/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp
  chmod +x /usr/local/bin/wp
fi
wp --allow-root --version >/dev/null 2>&1 && ok "$(wp --allow-root --version)" || warn "wp-cli không chạy được (cần php-cli)"

# ---- nginx --------------------------------------------------------------------
step "Nginx"
if [[ $NGINX_PREEXISTING == 1 ]]; then
  # Refuse to touch a config that is already broken - we could not tell our errors from existing ones.
  "$NGINX_BIN" -t >/dev/null 2>&1 || die "Cấu hình nginx hiện tại đang lỗi ('nginx -t'). Hãy sửa trước khi cài TPanel."
else
  [[ $COEXIST == 1 ]] && block_service_start
  $APT install nginx
  restore_policy_rc
  # Stock "Welcome to nginx" site of a package we just installed - safe to remove.
  [[ -L /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
fi
[[ -x "$NGINX_BIN" ]] || die "Không tìm thấy $NGINX_BIN sau khi cài nginx"

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
if ! grep -Eq '^\s*include\s+/etc/nginx/sites-enabled/' /etc/nginx/nginx.conf; then
  if grep -Eq '^\s*include\s+/etc/nginx/conf\.d/\*\.conf;' /etc/nginx/nginx.conf; then
    cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.tpanel-bak-$(date +%s)"
    sed -i -E 's#^(\s*)include\s+/etc/nginx/conf\.d/\*\.conf;#&\n\1include /etc/nginx/sites-enabled/*;#' /etc/nginx/nginx.conf
    ok "Đã thêm include sites-enabled vào nginx.conf (có bản sao lưu)"
  else
    warn "nginx.conf không include conf.d/ hay sites-enabled/ - hãy tự thêm 'include /etc/nginx/conf.d/*.conf; include /etc/nginx/sites-enabled/*;' trong khối http {}"
  fi
fi

# Catch-all so unknown hostnames are dropped instead of landing on the first site.
# Skipped automatically when the server already has its own default_server.
CATCHALL=/etc/nginx/conf.d/99-tpanel-default.conf
cat > "$CATCHALL" <<NGX
# Managed by TPanel
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ { root $DATA_DIR/acme; try_files \$uri =404; }
    location / { return 444; }
}
NGX
if ! "$NGINX_BIN" -t >/dev/null 2>&1; then
  rm -f "$CATCHALL"
  ok "Server đã có default_server riêng - bỏ qua catch-all của TPanel"
fi
"$NGINX_BIN" -t >/dev/null 2>&1 || die "nginx -t lỗi sau khi cấu hình: $("$NGINX_BIN" -t 2>&1 | tail -3)"

if [[ $COEXIST == 1 ]]; then
  systemctl disable nginx >/dev/null 2>&1 || true
  systemctl stop nginx >/dev/null 2>&1 || true
  warn "nginx của TPanel chưa chạy vì port 80/443 đang do $WEB_FOREIGN giữ"
elif systemctl is-active --quiet nginx; then
  systemctl reload nginx
  ok "nginx đang chạy - đã reload"
else
  systemctl enable --now nginx >/dev/null
  ok "nginx đã khởi động"
fi

# ---- Directories ------------------------------------------------------------
step "Tạo thư mục"
install -d -m 755 /var/www "$CONF_DIR" "$CONF_DIR/apps" /var/log/tpanel /var/log/tpanel/sites
install -d -m 700 "$CONF_DIR/ssl" "$INSTALL_DIR"
install -d -m 711 "$DATA_DIR"
install -d -m 755 "$DATA_DIR/acme"
install -d -m 755 "$DATA_DIR/templates"   # your own templates - kept across upgrades

# ---- Fetch & build TPanel ----------------------------------------------------
step "Tải mã nguồn TPanel"
SRC="$INSTALL_DIR/src"
if [[ -n "$TPANEL_TARBALL" ]]; then
  tmp=$(mktemp -d)
  curl -fsSL "$TPANEL_TARBALL" | tar -xz -C "$tmp"
  inner=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)
  rsync -a --delete --exclude node_modules "${inner:-$tmp}/" "$SRC/"
  rm -rf "$tmp"
elif [[ -d "$SRC/.git" ]]; then
  git -C "$SRC" fetch --depth 1 origin "$TPANEL_BRANCH"
  git -C "$SRC" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$TPANEL_BRANCH" "$TPANEL_REPO" "$SRC"
fi
ok "Mã nguồn tại $SRC"

step "Build TPanel (có thể mất 1-2 phút)"
cd "$SRC"
export PATH="/usr/bin:$PATH"   # build with the same node the service will run
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build
ok "Build xong"

# ---- Panel TLS (self-signed; replace with a real cert any time) ---------------
if [[ ! -f "$CONF_DIR/panel.crt" ]]; then
  step "Tạo chứng chỉ HTTPS tự ký cho trang quản trị"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=TPanel" \
    -keyout "$CONF_DIR/panel.key" -out "$CONF_DIR/panel.crt" >/dev/null 2>&1
  chmod 600 "$CONF_DIR/panel.key"
fi

# ---- Environment file ---------------------------------------------------------
set_env() { # add or replace KEY=VALUE in the env file
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
ADMIN_PASS=""
if [[ $UPGRADE == 0 ]]; then
  ADMIN_PASS=$(rand 16)
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
TPANEL_PORT=$TPANEL_PORT
TPANEL_HOST=0.0.0.0
TPANEL_DATA_DIR=$DATA_DIR
TPANEL_SECRET=$(rand 64)
TPANEL_WEB_DIST=$SRC/apps/web/dist
TPANEL_TLS_CERT=$CONF_DIR/panel.crt
TPANEL_TLS_KEY=$CONF_DIR/panel.key
TPANEL_ADMIN_USER=admin
TPANEL_ADMIN_PASSWORD=$ADMIN_PASS
TPANEL_DRY_RUN=0
TPANEL_SITES_ROOT=/var/www
TPANEL_ACME_DIR=$DATA_DIR/acme
TPANEL_DEFAULT_PHP=$(echo "$PHP_VERSIONS" | awk '{print $1}')
TPANEL_NGINX_BIN=$NGINX_BIN
$MYSQL_ENV_CONN
TPANEL_MYSQL_USER=tpanel
TPANEL_MYSQL_PASSWORD=$MYSQL_PASS
ENV
  umask 022
else
  set_env TPANEL_PORT "$TPANEL_PORT"
  set_env TPANEL_NGINX_BIN "$NGINX_BIN"
fi

# ---- systemd ------------------------------------------------------------------
step "Tạo service systemd"
cat > /etc/systemd/system/tpanel.service <<UNIT
[Unit]
Description=TPanel hosting control panel
After=network-online.target mariadb.service mysql.service nginx.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SRC/apps/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable tpanel >/dev/null

# Upgrade: snapshot TPanel's own state first (env/secret, certificates, SQLite, custom templates).
# Websites, their files and MySQL databases are never touched by an upgrade.
if [[ $UPGRADE == 1 && -f "$DATA_DIR/tpanel.db" ]]; then
  step "Sao lưu dữ liệu TPanel trước khi cập nhật"
  BACKUP_DIR="$DATA_DIR/backups"
  install -d -m 700 "$BACKUP_DIR"
  systemctl stop tpanel 2>/dev/null || true   # consistent SQLite copy (WAL files included)
  BACKUP_FILE="$BACKUP_DIR/tpanel-$(date +%Y%m%d-%H%M%S).tar.gz"
  (cd / && tar -czf "$BACKUP_FILE" etc/tpanel ${DATA_DIR#/}/tpanel.db* $( [[ -d "$DATA_DIR/templates" ]] && echo "${DATA_DIR#/}/templates" ))
  chmod 600 "$BACKUP_FILE"
  ls -1t "$BACKUP_DIR"/tpanel-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f   # keep the 5 newest
  ok "Đã sao lưu: $BACKUP_FILE"
fi
systemctl restart tpanel
# The server creates the admin account before it starts listening, so a 401 from the API means it is ready.
ready=0
for _ in $(seq 1 30); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$TPANEL_PORT/api/auth/me" || true)
  [[ "$code" == 401 ]] && { ready=1; break; }
  sleep 1
done
[[ $ready == 1 ]] || { journalctl -u tpanel -n 40 --no-pager; die "TPanel không khởi động được (không phản hồi trên port $TPANEL_PORT sau 30s)"; }
ok "tpanel.service đang chạy"

# Admin CLI: sudo tpanel users | sudo tpanel reset-password [user]
cat > /usr/local/bin/tpanel <<CLI
#!/bin/bash
[ "\$(id -u)" -eq 0 ] || { echo "Hãy chạy bằng sudo: sudo tpanel \$*"; exit 1; }
set -a; . $ENV_FILE; set +a
cd $SRC/apps/server && exec /usr/bin/node dist/cli.js "\$@"
CLI
chmod 755 /usr/local/bin/tpanel

if [[ -n "$ADMIN_PASS" ]]; then
  # Make sure the password we are about to print is really the one stored (bcrypt) in SQLite,
  # then drop the plaintext copy from the env file.
  /usr/local/bin/tpanel reset-password admin --password "$ADMIN_PASS" >/dev/null
  sed -i 's/^TPANEL_ADMIN_PASSWORD=.*/TPANEL_ADMIN_PASSWORD=/' "$ENV_FILE"
fi

# ---- Firewall -----------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  step "Mở port firewall (ufw)"
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow "$TPANEL_PORT/tcp" >/dev/null
  ok "ufw: 22, 80, 443, $TPANEL_PORT"
fi

# ---- Done ---------------------------------------------------------------------
IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo -e "${c_green}==============================================================${c_off}"
if [[ $UPGRADE == 1 ]]; then
  echo -e "${c_green} TPanel đã được nâng cấp${c_off} (website và database không bị thay đổi)"
  echo -e "  URL:  https://$IP:$TPANEL_PORT"
  [[ -n "${BACKUP_FILE:-}" ]] && echo -e "  Bản sao lưu trước khi nâng cấp: $BACKUP_FILE"
else
  echo -e "${c_green} Cài đặt TPanel thành công!${c_off}"
  echo -e "  URL:       https://$IP:$TPANEL_PORT   (chứng chỉ tự ký - trình duyệt sẽ cảnh báo)"
  echo -e "  Tài khoản: admin"
  echo -e "  Mật khẩu:  $ADMIN_PASS"
  echo -e "  ${c_yellow}Hãy lưu mật khẩu này và đổi ngay sau khi đăng nhập.${c_off}"
fi
echo -e "  Quên mật khẩu: sudo tpanel reset-password"
echo -e "  Log:       journalctl -u tpanel -f"
if [[ $COEXIST == 1 ]]; then
  echo
  echo -e "${c_yellow} CHẾ ĐỘ CÙNG TỒN TẠI:${c_off} port 80/443 đang do $WEB_FOREIGN giữ."
  echo -e "  Dùng mục 'Chuyển site' để chuyển các site về TPanel. Khi đã sẵn sàng chuyển traffic:"
  echo -e "    1. Dừng & tắt web server cũ (vd: systemctl disable --now apache2 / lsws / nginx của panel cũ)"
  echo -e "    2. systemctl enable --now nginx"
  echo -e "    3. Cài SSL cho từng site trong TPanel"
fi
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo
  echo -e "${c_yellow} Lưu ý:${c_off}"
  for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo -e "${c_green}==============================================================${c_off}"
