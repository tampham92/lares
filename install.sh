#!/usr/bin/env bash
# =============================================================================
#  Lares Panel installer (Lares Panel by ThoCode - https://thocode.dev)
#
#    curl -sSL https://lares.thocode.dev/install | sudo bash
#    curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443 --php "8.3 8.2"
#
#  VPS đã có MySQL/MariaDB với mật khẩu root:
#    curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --mysql-root-password 'xxx'
#
#  English output + English as the panel's default language:
#    curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en
#
#  Supported: Ubuntu 22.04 / 24.04, Debian 12 (x86_64, arm64). Debian 13: not yet tested (warning).
#  Ubuntu 20.04 / Debian 11 and older (end of life) are refused unless --force-unsupported is given.
#  Re-running the script upgrades Lares in place (keeps data, admin & DB credentials).
#
#  Existing services are detected and reused, never replaced:
#   - MySQL / MariaDB / Percona already installed (apt or panel-built): reused, Lares gets its own admin user
#   - nginx from apt: reused, existing vhosts / default site untouched
#   - port 80/443 held by another web server (Apache, OpenLiteSpeed, a panel's nginx): Lares's nginx is
#     installed but left stopped until you switch over ("coexist mode")
#
#  Anonymous install counter: one tiny ping on install/upgrade (random install id, Lares version,
#  event, OS id+version, arch, panel language - nothing else). Opt out: --no-telemetry, or
#  LARES_TELEMETRY=0 in /etc/lares/lares.env. Details: docs/en/installation.md#telemetry
# =============================================================================
set -Eeuo pipefail

# ---- Configurable (env vars or flags) ---------------------------------------
LARES_REPO="${LARES_REPO:-https://github.com/tampham92/lares.git}"
LARES_BRANCH="${LARES_BRANCH:-}"            # empty = newest release tag (vX.Y.Z); a branch or tag to override
LARES_TARBALL="${LARES_TARBALL:-}"          # URL/đường dẫn .tar.gz thay cho git (tuỳ chọn)
PORT_ARG="${LARES_PORT:-}"                  # empty = saved port on upgrade, else 8686
PHP_ARG="${PHP_VERSIONS:-}"                 # empty = saved versions on upgrade, else the default list
DEFAULT_PHP_VERSIONS="8.3 8.2 8.1 7.4"
NODE_MAJOR="${NODE_MAJOR:-22}"
MYSQL_ROOT_USER="${MYSQL_ROOT_USER:-root}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
FRESH_DATA=0
FORCE_UNSUPPORTED=0
TELEMETRY_ARG="${LARES_TELEMETRY:-}"        # 0 = no anonymous install ping / daily heartbeat
TELEMETRY_URL="${LARES_TELEMETRY_URL:-https://lares.thocode.dev/ping}"
INSTALL_DIR="/opt/lares"
DATA_DIR="/var/lib/lares"
CONF_DIR="/etc/lares"
ENV_FILE="$CONF_DIR/lares.env"
INSTALL_ID_FILE="$CONF_DIR/install-id"
NGINX_BIN="/usr/sbin/nginx"

# ---- Language (vi | en) - resolved first so every message below is translated ---
# --lang wins, then LARES_LANG, then the language saved by a previous install, then vi.
LANG_ARG="${LARES_LANG:-}"; prev=""
for a in "$@"; do
  case "$a" in --lang=*) LANG_ARG="${a#--lang=}" ;; esac
  [[ "$prev" == --lang ]] && LANG_ARG="$a"
  prev="$a"
done
LANG_UI="$LANG_ARG"
if [[ -z "$LANG_UI" && -r "$ENV_FILE" ]]; then
  LANG_UI=$(grep -E '^LARES_LANG=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
fi
LANG_UI=$(printf '%s' "${LANG_UI:-vi}" | tr '[:upper:]' '[:lower:]'); LANG_UI="${LANG_UI:0:2}"
case "$LANG_UI" in
  vi|en) ;;
  *) [[ -n "$LANG_ARG" ]] && { echo "--lang: vi | en" >&2; exit 1; }; LANG_UI="vi" ;;
esac
# L 'Tiếng Việt' 'English' -> the text for the chosen language
L() { if [[ $LANG_UI == en ]]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

usage() {
  if [[ $LANG_UI == en ]]; then
    cat <<'TXT'
Lares installer - installs Lares, or upgrades it in place when it is already installed
(sites, data, admin account and DB credentials are kept).

Usage:
  curl -sSL https://lares.thocode.dev/install | sudo bash -s -- [options]

Options:
  --lang vi|en                 Installer language and panel default language
                               (default: vi; an upgrade keeps the saved language)
  --port <port>                Panel HTTPS port (default: 8686; an upgrade keeps the saved port)
  --php "<versions>"           PHP versions to install (default: "8.3 8.2 8.1 7.4";
                               an upgrade keeps the saved versions)
  --node <major>               Node.js major version when Node >= 20 is missing (default: 22)
  --mysql-root-user <user>     Admin user of an existing MySQL/MariaDB (default: root)
  --mysql-root-password <pw>   Its password, when socket login does not work
  --repo <url>                 Git repository (default: https://github.com/tampham92/lares.git)
  --branch <name>              Git branch or tag (default: the newest release tag vX.Y.Z)
  --tarball <url|path>         Install from a .tar.gz (URL, file:// or local path) instead of git
  --fresh-data                 Old data found without its env file: back it up and install fresh
  --no-telemetry               Do not send the anonymous install/upgrade ping or the daily
                               heartbeat (saved as LARES_TELEMETRY=0 in /etc/lares/lares.env)
  --force-unsupported          Install on an end-of-life / unsupported OS anyway (no support)
  -h, --help                   Show this help

Supported: Ubuntu 22.04 / 24.04, Debian 12 (x86_64, arm64). Debian 13: not yet tested.
Anonymous telemetry sends only: a random install id, Lares version, event (install/upgrade/
heartbeat), OS id + version, CPU architecture, panel language. Never IPs, domains or site data.
TXT
  else
    cat <<'TXT'
Lares installer - cài Lares, hoặc nâng cấp tại chỗ nếu đã cài
(giữ nguyên site, dữ liệu, tài khoản admin và thông tin database).

Cách dùng:
  curl -sSL https://lares.thocode.dev/install | sudo bash -s -- [tuỳ chọn]

Tuỳ chọn:
  --lang vi|en                 Ngôn ngữ của installer và ngôn ngữ mặc định của panel
                               (mặc định: vi; khi nâng cấp giữ ngôn ngữ đã lưu)
  --port <port>                Port HTTPS của trang quản trị (mặc định: 8686; nâng cấp giữ port đã lưu)
  --php "<phiên bản>"          Các phiên bản PHP cần cài (mặc định: "8.3 8.2 8.1 7.4";
                               nâng cấp giữ các phiên bản đã lưu)
  --node <major>               Phiên bản Node.js khi chưa có Node >= 20 (mặc định: 22)
  --mysql-root-user <user>     User quản trị MySQL/MariaDB đang có (mặc định: root)
  --mysql-root-password <mk>   Mật khẩu của user đó, khi không đăng nhập được qua socket
  --repo <url>                 Kho git (mặc định: https://github.com/tampham92/lares.git)
  --branch <tên>               Nhánh hoặc tag git (mặc định: tag phát hành mới nhất vX.Y.Z)
  --tarball <url|đường dẫn>    Cài từ file .tar.gz (URL, file:// hoặc đường dẫn trên máy) thay cho git
  --fresh-data                 Có dữ liệu cũ nhưng thiếu file env: sao lưu dữ liệu cũ rồi cài mới
  --no-telemetry               Không gửi ping ẩn danh khi cài/nâng cấp và heartbeat hằng ngày
                               (lưu thành LARES_TELEMETRY=0 trong /etc/lares/lares.env)
  --force-unsupported          Vẫn cài trên HĐH đã hết hạn hỗ trợ / không được hỗ trợ (tự chịu rủi ro)
  -h, --help                   Hiện trợ giúp này

Hỗ trợ: Ubuntu 22.04 / 24.04, Debian 12 (x86_64, arm64). Debian 13: chưa kiểm thử.
Thống kê ẩn danh chỉ gửi: mã cài đặt ngẫu nhiên, phiên bản Lares, sự kiện (install/upgrade/
heartbeat), tên + phiên bản HĐH, kiến trúc CPU, ngôn ngữ panel. Không bao giờ gửi IP, tên miền hay dữ liệu site.
TXT
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lang) [[ $# -ge 2 ]] || { echo "--lang: vi | en" >&2; exit 1; }; shift 2 ;;   # read above
    --lang=*) shift ;;
    --port) PORT_ARG="$2"; shift 2 ;;
    --php) PHP_ARG="$2"; shift 2 ;;
    --node) NODE_MAJOR="$2"; shift 2 ;;
    --repo) LARES_REPO="$2"; shift 2 ;;
    --branch) LARES_BRANCH="$2"; shift 2 ;;
    --tarball) LARES_TARBALL="$2"; shift 2 ;;
    --mysql-root-user) MYSQL_ROOT_USER="$2"; shift 2 ;;
    --mysql-root-password) MYSQL_ROOT_PASSWORD="$2"; shift 2 ;;
    --fresh-data) FRESH_DATA=1; shift ;;
    --no-telemetry) TELEMETRY_ARG=0; shift ;;
    --force-unsupported) FORCE_UNSUPPORTED=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "$(L 'Tham số không hợp lệ' 'Invalid option'): $1 ($(L 'xem' 'see') --help)"; exit 1 ;;
  esac
done

# An upgrade (often the plain one-liner shown in the panel) keeps the port and PHP versions chosen at
# install time unless --port / --php are given again.
saved_env() { [[ -r "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
LARES_PORT="${PORT_ARG:-$(saved_env LARES_PORT)}"; LARES_PORT="${LARES_PORT:-8686}"
[[ "$LARES_PORT" =~ ^[0-9]{2,5}$ ]] && (( LARES_PORT <= 65535 )) || { echo "--port: 1-65535" >&2; exit 1; }
PHP_VERSIONS="${PHP_ARG:-$(saved_env LARES_PHP_VERSIONS | tr ',' ' ')}"
if [[ -z "$PHP_VERSIONS" && -f "$ENV_FILE" ]]; then
  # Installed before LARES_PHP_VERSIONS was saved: keep the PHP-FPM versions that are already there.
  for d in /etc/php/*/fpm; do [[ -d "$d" ]] && PHP_VERSIONS+="$(basename "$(dirname "$d")") "; done
fi
PHP_VERSIONS=$(echo "${PHP_VERSIONS:-$DEFAULT_PHP_VERSIONS}" | xargs)

# ---- Helpers ----------------------------------------------------------------
c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_blue='\033[0;34m'; c_off='\033[0m'
step() { echo -e "\n${c_blue}==>${c_off} $*"; }
ok()   { echo -e "${c_green}✔${c_off} $*"; }
warn() { echo -e "${c_yellow}!${c_off} $*"; WARNINGS+=("$*"); }
die()  { echo -e "${c_red}✘ $*${c_off}" >&2; exit 1; }
# Newest vX.Y.Z[-prerelease] tag of a git repo, in semver order (0.3.0 beats 0.3.0-beta, 0.10.0 beats
# 0.9.0); prerelease labels compare as text. Prints nothing if there is none or the repo is unreachable.
latest_release_tag() {
  git ls-remote --tags --refs "$1" 'v*' 2>/dev/null | awk '{ sub("^refs/tags/", "", $2); print $2 }' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]{1,20})?$' \
    | awk '{ v = substr($0, 2); pre = "~"; i = index(v, "-")
             if (i) { pre = "!" substr(v, i + 1); v = substr(v, 1, i - 1) }
             split(v, n, "."); printf "%09d.%09d.%09d.%s\t%s\n", n[1], n[2], n[3], pre, $0 }' \
    | LC_ALL=C sort | tail -n 1 | cut -f 2 || true
}
trap 'die "$(L "Cài đặt thất bại ở dòng $LINENO (lệnh: $BASH_COMMAND)" "Installation failed at line $LINENO (command: $BASH_COMMAND)")"' ERR
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
[[ $EUID -eq 0 ]] || die "$(L 'Hãy chạy với quyền root' 'Please run as root'): curl -sSL https://lares.thocode.dev/install | sudo bash"
[[ -r /etc/os-release ]] || die "$(L 'Không xác định được hệ điều hành' 'Cannot determine the operating system')"
# shellcheck source=/dev/null
. /etc/os-release
PRETTY_NAME="${PRETTY_NAME:-${ID:-unknown} ${VERSION_ID:-}}"
# Refuse (unless --force-unsupported) instead of half-installing on a system we cannot support.
unsupported_os() {
  if [[ $FORCE_UNSUPPORTED == 1 ]]; then
    warn "$1 - $(L 'vẫn tiếp tục vì có --force-unsupported (không được hỗ trợ)' 'continuing because of --force-unsupported (unsupported)')"
  else
    die "$1
   $(L 'Hỗ trợ chính thức' 'Officially supported'): Ubuntu 22.04 / 24.04, Debian 12.
   $(L 'Hãy dùng một trong các HĐH trên, hoặc chấp nhận rủi ro và chạy lại với' 'Use one of those, or accept the risk and run again with'): ... | sudo bash -s -- --force-unsupported"
  fi
}
OS_MAJOR="${VERSION_ID:-}"; OS_MAJOR="${OS_MAJOR%%.*}"
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:22.04|ubuntu:24.04|debian:12) ;;
  debian:13) warn "$(L "$PRETTY_NAME chưa được kiểm thử - Lares có thể chạy nhưng chưa được hỗ trợ chính thức" "$PRETTY_NAME is not yet tested - Lares may work but is not officially supported yet")" ;;
  ubuntu:*|debian:*)
    if [[ "$OS_MAJOR" =~ ^[0-9]+$ ]] && { [[ $ID == ubuntu ]] && (( OS_MAJOR < 22 )) || { [[ $ID == debian ]] && (( OS_MAJOR < 12 )); }; }; then
      unsupported_os "$(L "$PRETTY_NAME đã hết vòng đời (end of life) - không còn bản vá bảo mật, Lares không hỗ trợ" "$PRETTY_NAME is end of life - no more security updates, Lares does not support it")"
    else
      warn "$(L "$PRETTY_NAME chưa được kiểm thử - Lares có thể chạy nhưng chưa được hỗ trợ chính thức" "$PRETTY_NAME is not yet tested - Lares may work but is not officially supported yet")"
    fi ;;
  *) unsupported_os "$(L "$PRETTY_NAME không phải Ubuntu/Debian" "$PRETTY_NAME is not Ubuntu/Debian")" ;;
esac
command -v apt-get >/dev/null || die "$(L 'Cần apt-get (Debian/Ubuntu)' 'apt-get is required (Debian/Ubuntu)')"
ARCH=$(dpkg --print-architecture)
[[ "$ARCH" == amd64 || "$ARCH" == arm64 ]] || die "$(L "Kiến trúc $ARCH không được hỗ trợ" "Architecture $ARCH is not supported")"
if [[ -n "$(port_pids "$LARES_PORT")" ]] && ! systemctl is-active --quiet lares; then
  die "$(L "Port $LARES_PORT đang được dùng. Chọn port khác" "Port $LARES_PORT is already in use. Pick another port"): ... | sudo bash -s -- --port 9443"
fi

UPGRADE=0; [[ -f "$ENV_FILE" ]] && UPGRADE=1
# Data from an earlier install without its env file: the env holds LARES_SECRET, which decrypts the stored
# DB/SSH credentials, and the admin account already exists - a "fresh" install would silently break both.
if [[ $UPGRADE == 0 && -f "$DATA_DIR/lares.db" ]]; then
  if [[ $FRESH_DATA == 1 ]]; then
    mv "$DATA_DIR" "$DATA_DIR.bak-$(date +%Y%m%d%H%M%S)"
    warn "$(L "Đã chuyển dữ liệu Lares cũ sang $DATA_DIR.bak-* và cài mới" "Moved the old Lares data to $DATA_DIR.bak-* and installed fresh")"
  else
    die "$(L "Tìm thấy dữ liệu Lares cũ ($DATA_DIR) nhưng thiếu $ENV_FILE (chứa khoá giải mã).
   - Khôi phục $ENV_FILE từ bản sao lưu rồi chạy lại installer (giữ nguyên site & tài khoản), hoặc
   - Cài mới, dữ liệu cũ được đổi tên thành bản sao lưu: ... | sudo bash -s -- --fresh-data" \
"Found old Lares data ($DATA_DIR) but $ENV_FILE (which holds the decryption key) is missing.
   - Restore $ENV_FILE from a backup and run the installer again (keeps sites & accounts), or
   - Install fresh, renaming the old data to a backup: ... | sudo bash -s -- --fresh-data")"
  fi
fi
echo -e "${c_blue}Lares Panel installer${c_off} - $PRETTY_NAME ($ARCH) - $([[ $UPGRADE == 1 ]] && L 'NÂNG CẤP' 'UPGRADE' || L 'CÀI MỚI' 'FRESH INSTALL')"

# ---- Detect what is already on this server -----------------------------------
step "$(L 'Kiểm tra dịch vụ đang có trên VPS' 'Checking existing services on this server')"
NGINX_PREEXISTING=0; pkg_installed nginx-common && NGINX_PREEXISTING=1
WEB_FOREIGN=""
WEB_FOREIGN=$(foreign_listener 80 || foreign_listener 443 || true)
COEXIST=0; [[ -n "$WEB_FOREIGN" ]] && COEXIST=1

DB_PREEXISTING=0
if any_pkg_installed mariadb-server mysql-server mysql-community-server percona-server-server percona-xtradb-cluster-server \
   || [[ -n "$(port_pids 3306)" ]] || pgrep -x 'mysqld|mariadbd' >/dev/null 2>&1; then
  DB_PREEXISTING=1
fi

[[ $NGINX_PREEXISTING == 1 ]] && ok "$(L 'nginx (apt) đã có - dùng lại, không đụng tới vhost hiện có' 'nginx (apt) already installed - reusing it, existing vhosts untouched')"
[[ $COEXIST == 1 ]] && warn "$(L "Port 80/443 đang do $WEB_FOREIGN giữ → nginx của Lares sẽ được cài nhưng CHƯA chạy (chế độ cùng tồn tại)" "Port 80/443 is held by $WEB_FOREIGN → Lares's nginx will be installed but NOT started (coexist mode)")"
[[ $DB_PREEXISTING == 1 ]] && ok "$(L 'MySQL/MariaDB đã có - dùng lại, không cài đè' 'MySQL/MariaDB already installed - reusing it, not reinstalling')"

# ---- Base packages ----------------------------------------------------------
step "$(L 'Cài gói hệ thống cơ bản' 'Installing base system packages')"
$APT update || warn "$(L 'apt-get update báo lỗi (thường do repo bên thứ ba hỏng) - vẫn tiếp tục' 'apt-get update reported errors (usually a broken third-party repo) - continuing')"
$APT install curl ca-certificates gnupg git tar gzip pigz rsync unzip openssl lsb-release cron logrotate \
  iproute2 procps sudo apt-transport-https
ok "$(L 'Gói cơ bản' 'Base packages')"

# ---- IPv6 without a route ---------------------------------------------------
# Some VPS get a global IPv6 address but no IPv6 route to the Internet. curl and Node fall back to
# IPv4 at once; other clients do not (Turbopack's Google Fonts download in `next build` fails).
# When IPv4 works and IPv6 does not, make getaddrinfo prefer IPv4 (RFC 6724 precedence for
# v4-mapped addresses). IPv6 itself stays on: nginx keeps listening on [::]. A precedence the
# admin already set for ::ffff:0:0/96 is left alone. uninstall.sh --purge removes the line.
GAI_MARK='# Added by Lares: no working IPv6 route on this server, prefer IPv4'
probe_net() { curl "-$1" -fsS -o /dev/null --max-time 8 https://www.google.com/generate_204 2>/dev/null; }
if ip -6 addr show scope global 2>/dev/null | grep -q inet6 \
  && ! grep -qE '^[[:space:]]*precedence[[:space:]]+::ffff:0:0/96' /etc/gai.conf 2>/dev/null \
  && probe_net 4 && ! probe_net 6; then
  printf '%s\nprecedence ::ffff:0:0/96  100\n' "$GAI_MARK" >> /etc/gai.conf
  warn "$(L 'IPv6 trên máy chủ này không ra được Internet: đã cho hệ thống ưu tiên IPv4 (/etc/gai.conf). Lares sẽ không tạo bản ghi AAAA cho máy chủ này.' 'IPv6 on this server cannot reach the Internet: the system now prefers IPv4 (/etc/gai.conf). Lares will not create AAAA records for it.')"
fi

# ---- PHP repository (ondrej / sury) -----------------------------------------
step "$(L 'Thêm kho PHP nhiều phiên bản' 'Adding the multi-version PHP repository')"
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
  step "$(L "Thêm kho Node.js $NODE_MAJOR.x" "Adding the Node.js $NODE_MAJOR.x repository")"
  (( $(node_major) > 0 )) && warn "$(L "Node.js $(/usr/bin/node -v) trong /usr/bin sẽ được nâng lên $NODE_MAJOR.x (Lares cần >= 20)" "Node.js $(/usr/bin/node -v) in /usr/bin will be upgraded to $NODE_MAJOR.x (Lares needs >= 20)")"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
fi
$APT update || warn "$(L 'apt-get update báo lỗi - vẫn tiếp tục' 'apt-get update reported errors - continuing')"

# ---- Node, certbot ------------------------------------------------------------
step "$(L 'Cài Node.js, Certbot' 'Installing Node.js, Certbot')"
if (( $(node_major) < 20 )); then $APT install nodejs; fi
(( $(node_major) >= 20 )) || die "$(L 'Không cài được Node.js >= 20 vào /usr/bin/node' 'Could not install Node.js >= 20 into /usr/bin/node')"
corepack enable >/dev/null 2>&1 || true
pkg_installed certbot || command -v certbot >/dev/null || $APT install certbot
ok "node $(/usr/bin/node -v), $(certbot --version 2>&1 | head -1)"

# ---- MySQL / MariaDB ----------------------------------------------------------
step "MySQL / MariaDB"
if [[ $DB_PREEXISTING == 0 ]]; then
  $APT install mariadb-server mariadb-client
  systemctl enable --now mariadb >/dev/null
  ok "$(L 'Đã cài MariaDB' 'Installed MariaDB') $(mysql --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
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
    die "$(L "Không đăng nhập được MySQL/MariaDB đang có với quyền quản trị.
   Chạy lại kèm mật khẩu root của database:
     curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --mysql-root-password 'MẬT_KHẨU'
   (hoặc --mysql-root-user <user> nếu tài khoản quản trị không phải root)" \
"Could not log in to the existing MySQL/MariaDB as an administrator.
   Run again with the database root password:
     curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en --mysql-root-password 'PASSWORD'
   (or --mysql-root-user <user> if the admin account is not root)")"
  fi
  DB_VERSION=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT VERSION()')
  DB_SOCKET=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT @@socket' 2>/dev/null || true)
  DB_PORT=$("${MYSQL_ADMIN[@]}" -N -B -e 'SELECT @@port' 2>/dev/null || echo 3306)
  MYSQL_PASS=$(rand 32)
  # 'localhost' = socket connections, '127.0.0.1' = TCP; create both so either transport works.
  # Deliberately no hardening statements (DROP DATABASE test, anonymous users...): this may be a live server.
  "${MYSQL_ADMIN[@]}" <<SQL
CREATE USER IF NOT EXISTS 'lares'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
ALTER USER 'lares'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON *.* TO 'lares'@'localhost' WITH GRANT OPTION;
CREATE USER IF NOT EXISTS 'lares'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
ALTER USER 'lares'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
GRANT ALL PRIVILEGES ON *.* TO 'lares'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL
  if [[ -n "$DB_SOCKET" && -S "$DB_SOCKET" ]]; then
    MYSQL_ENV_CONN="LARES_MYSQL_SOCKET=$DB_SOCKET"
  else
    MYSQL_ENV_CONN=$'LARES_MYSQL_SOCKET=\nLARES_MYSQL_HOST=127.0.0.1\nLARES_MYSQL_PORT='"$DB_PORT"
  fi
  ok "$(L "Tài khoản 'lares' trên" "Account 'lares' on") $DB_VERSION (${DB_SOCKET:-127.0.0.1:$DB_PORT})"
fi

# ---- PHP-FPM ------------------------------------------------------------------
step "$(L 'Cài PHP-FPM' 'Installing PHP-FPM'): $PHP_VERSIONS"
for v in $PHP_VERSIONS; do
  fresh=1; pkg_installed "php$v-fpm" && fresh=0
  core=()
  for p in fpm cli mysql curl gd mbstring xml zip intl bcmath opcache; do core+=("php$v-$p"); done
  if $APT install "${core[@]}"; then
    for p in soap imagick redis; do $APT install "php$v-$p" >/dev/null 2>&1 || warn "PHP $v: $(L 'thiếu extension' 'missing extension') $p"; done
    # Only tune php.ini on versions we installed - an existing server's settings are left alone.
    if [[ $fresh == 1 ]]; then
      sed -i -E 's/^;?upload_max_filesize.*/upload_max_filesize = 256M/; s/^;?post_max_size.*/post_max_size = 256M/; s/^;?memory_limit.*/memory_limit = 512M/; s/^;?max_execution_time.*/max_execution_time = 300/' "/etc/php/$v/fpm/php.ini"
    fi
    systemctl enable --now "php$v-fpm" >/dev/null || warn "$(L "Không khởi động được php$v-fpm" "Could not start php$v-fpm")"
    ok "PHP $v$([[ $fresh == 0 ]] && L ' (đã có)' ' (already installed)')"
  else
    warn "$(L "Không cài được PHP $v - bỏ qua" "Could not install PHP $v - skipped")"
  fi
done

step "$(L 'Cài WP-CLI' 'Installing WP-CLI')"
if ! command -v wp >/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp
  chmod +x /usr/local/bin/wp
fi
wp --allow-root --version >/dev/null 2>&1 && ok "$(wp --allow-root --version)" || warn "$(L 'wp-cli không chạy được (cần php-cli)' 'wp-cli does not run (needs php-cli)')"

# ---- nginx --------------------------------------------------------------------
step "Nginx"
if [[ $NGINX_PREEXISTING == 1 ]]; then
  # Refuse to touch a config that is already broken - we could not tell our errors from existing ones.
  "$NGINX_BIN" -t >/dev/null 2>&1 || die "$(L "Cấu hình nginx hiện tại đang lỗi ('nginx -t'). Hãy sửa trước khi cài Lares." "The current nginx configuration is broken ('nginx -t'). Fix it before installing Lares.")"
else
  [[ $COEXIST == 1 ]] && block_service_start
  $APT install nginx
  restore_policy_rc
  # Stock "Welcome to nginx" site of a package we just installed - safe to remove.
  [[ -L /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
fi
[[ -x "$NGINX_BIN" ]] || die "$(L "Không tìm thấy $NGINX_BIN sau khi cài nginx" "$NGINX_BIN not found after installing nginx")"

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
if ! grep -Eq '^\s*include\s+/etc/nginx/sites-enabled/' /etc/nginx/nginx.conf; then
  if grep -Eq '^\s*include\s+/etc/nginx/conf\.d/\*\.conf;' /etc/nginx/nginx.conf; then
    cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.lares-bak-$(date +%s)"
    sed -i -E 's#^(\s*)include\s+/etc/nginx/conf\.d/\*\.conf;#&\n\1include /etc/nginx/sites-enabled/*;#' /etc/nginx/nginx.conf
    ok "$(L 'Đã thêm include sites-enabled vào nginx.conf (có bản sao lưu)' 'Added the sites-enabled include to nginx.conf (backup kept)')"
  else
    warn "$(L "nginx.conf không include conf.d/ hay sites-enabled/ - hãy tự thêm 'include /etc/nginx/conf.d/*.conf; include /etc/nginx/sites-enabled/*;' trong khối http {}" "nginx.conf includes neither conf.d/ nor sites-enabled/ - add 'include /etc/nginx/conf.d/*.conf; include /etc/nginx/sites-enabled/*;' inside the http {} block yourself")"
  fi
fi

# Catch-all so unknown hostnames are dropped instead of landing on the first site.
# Skipped automatically when the server already has its own default_server.
CATCHALL=/etc/nginx/conf.d/99-lares-default.conf
cat > "$CATCHALL" <<NGX
# Managed by Lares
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
  ok "$(L 'Server đã có default_server riêng - bỏ qua catch-all của Lares' "The server already has its own default_server - skipping Lares's catch-all")"
fi
"$NGINX_BIN" -t >/dev/null 2>&1 || die "$(L 'nginx -t lỗi sau khi cấu hình' 'nginx -t failed after configuration'): $("$NGINX_BIN" -t 2>&1 | tail -3)"

if [[ $COEXIST == 1 ]]; then
  systemctl disable nginx >/dev/null 2>&1 || true
  systemctl stop nginx >/dev/null 2>&1 || true
  warn "$(L "nginx của Lares chưa chạy vì port 80/443 đang do $WEB_FOREIGN giữ" "Lares's nginx is not started because port 80/443 is held by $WEB_FOREIGN")"
elif systemctl is-active --quiet nginx; then
  systemctl reload nginx
  ok "$(L 'nginx đang chạy - đã reload' 'nginx is running - reloaded')"
else
  systemctl enable --now nginx >/dev/null
  ok "$(L 'nginx đã khởi động' 'nginx started')"
fi

# ---- Directories ------------------------------------------------------------
step "$(L 'Tạo thư mục' 'Creating directories')"
install -d -m 755 /var/www "$CONF_DIR" "$CONF_DIR/apps" /var/log/lares /var/log/lares/sites
install -d -m 700 "$CONF_DIR/ssl" "$INSTALL_DIR"
install -d -m 711 "$DATA_DIR"
install -d -m 755 "$DATA_DIR/acme"
install -d -m 755 "$DATA_DIR/templates"   # your own templates - kept across upgrades
install -d -m 700 "${LARES_BACKUP_DIR:-/var/backups/lares}"   # site backups (root only)
chmod 700 "${LARES_BACKUP_DIR:-/var/backups/lares}"

# ---- Fetch & build Lares ----------------------------------------------------
step "$(L 'Tải mã nguồn Lares' 'Downloading Lares source code')"
SRC="$INSTALL_DIR/src"
if [[ -n "$LARES_TARBALL" ]]; then
  tmp=$(mktemp -d)
  # A local path (CI, offline installs) or any URL curl understands (https://, file://)
  if [[ -f "$LARES_TARBALL" ]]; then tar -xzf "$LARES_TARBALL" -C "$tmp"; else curl -fsSL "$LARES_TARBALL" | tar -xz -C "$tmp"; fi
  # GitHub/`git archive --prefix` tarballs wrap everything in one directory; a flat tarball does not.
  top=$(find "$tmp" -mindepth 1 -maxdepth 1)
  inner="$tmp"
  [[ $(printf '%s\n' "$top" | wc -l) -eq 1 && -d "$top" ]] && inner="$top"
  [[ -f "$inner/package.json" && -d "$inner/apps/server" ]] || { rm -rf "$tmp"; die "$(L 'File tarball không chứa mã nguồn Lares' 'The tarball does not contain the Lares source code'): $LARES_TARBALL"; }
  rsync -a --delete --exclude node_modules "$inner/" "$SRC/"
  rm -rf "$tmp"
else
  # Releases are vX.Y.Z tags: code pushed to main reaches nobody until it is tagged. The panel's
  # update check and its "Upgrade" button look at the same tags.
  if [[ -z "$LARES_BRANCH" ]]; then
    repo_url="$LARES_REPO"
    [[ -d "$SRC/.git" ]] && repo_url=$(git -C "$SRC" remote get-url origin 2>/dev/null || echo "$LARES_REPO")
    LARES_BRANCH=$(latest_release_tag "$repo_url")
    if [[ -z "$LARES_BRANCH" ]]; then
      LARES_BRANCH=main
      warn "$(L 'Không tìm thấy tag phát hành (vX.Y.Z), dùng nhánh main' 'No release tag (vX.Y.Z) found, using the main branch')"
    fi
  fi
  if [[ -d "$SRC/.git" ]]; then
    git -C "$SRC" fetch --depth 1 origin "$LARES_BRANCH"
    git -C "$SRC" reset --hard FETCH_HEAD
  else
    rm -rf "$SRC"   # e.g. an earlier --tarball install: git clone needs an empty directory
    git clone --depth 1 --branch "$LARES_BRANCH" "$LARES_REPO" "$SRC"
  fi
fi
LARES_VERSION=$(/usr/bin/node -p 'require(process.argv[1]).version' "$SRC/package.json" 2>/dev/null || echo unknown)
ok "$(L 'Mã nguồn tại' 'Source code in') $SRC (Lares $LARES_VERSION)"

step "$(L 'Build Lares (có thể mất 1-2 phút)' 'Building Lares (may take 1-2 minutes)')"
cd "$SRC"
export PATH="/usr/bin:$PATH"   # build with the same node the service will run
# --include=dev: the build needs typescript/vite even if NODE_ENV=production leaked into this shell
if [[ -f package-lock.json ]]; then npm ci --include=dev --no-audit --no-fund; else npm install --include=dev --no-audit --no-fund; fi
npm run build
ok "$(L 'Build xong' 'Build finished')"

# ---- Panel TLS (self-signed; replace with a real cert any time) ---------------
if [[ ! -f "$CONF_DIR/panel.crt" ]]; then
  step "$(L 'Tạo chứng chỉ HTTPS tự ký cho trang quản trị' 'Creating a self-signed HTTPS certificate for the panel')"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Lares" \
    -keyout "$CONF_DIR/panel.key" -out "$CONF_DIR/panel.crt" >/dev/null 2>&1
  chmod 600 "$CONF_DIR/panel.key"
fi

# ---- Environment file ---------------------------------------------------------
set_env() { # add or replace KEY=VALUE in the env file
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
# Anonymous telemetry: --no-telemetry / LARES_TELEMETRY in the shell win, then the value saved by an
# earlier install, then on. Saved in the env file so the panel's daily heartbeat follows the same choice.
TELEMETRY="$TELEMETRY_ARG"
if [[ -z "$TELEMETRY" && -r "$ENV_FILE" ]]; then
  TELEMETRY=$(grep -E '^LARES_TELEMETRY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
fi
case "$(printf '%s' "$TELEMETRY" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off) TELEMETRY=0 ;;
  *) TELEMETRY=1 ;;
esac

ADMIN_PASS=""
if [[ $UPGRADE == 0 ]]; then
  ADMIN_PASS=$(rand 16)
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
LARES_PORT=$LARES_PORT
LARES_HOST=0.0.0.0
LARES_TRUST_PROXY=
LARES_DATA_DIR=$DATA_DIR
LARES_SECRET=$(rand 64)
LARES_WEB_DIST=$SRC/apps/web/dist
LARES_TLS_CERT=$CONF_DIR/panel.crt
LARES_TLS_KEY=$CONF_DIR/panel.key
LARES_ADMIN_USER=admin
LARES_ADMIN_PASSWORD=$ADMIN_PASS
LARES_DRY_RUN=0
LARES_SITES_ROOT=/var/www
LARES_ACME_DIR=$DATA_DIR/acme
LARES_DEFAULT_PHP=$(echo "$PHP_VERSIONS" | awk '{print $1}')
LARES_NGINX_BIN=$NGINX_BIN
LARES_LANG=$LANG_UI
$MYSQL_ENV_CONN
LARES_MYSQL_USER=lares
LARES_MYSQL_PASSWORD=$MYSQL_PASS
ENV
  umask 022
else
  set_env LARES_PORT "$LARES_PORT"
  set_env LARES_NGINX_BIN "$NGINX_BIN"
  set_env LARES_LANG "$LANG_UI"   # the saved one unless --lang was given
fi
set_env LARES_TELEMETRY "$TELEMETRY"
if [[ -n "${LARES_BACKUP_DIR:-}" ]]; then set_env LARES_BACKUP_DIR "$LARES_BACKUP_DIR"; fi
set_env LARES_PHP_VERSIONS "${PHP_VERSIONS// /,}"   # commas: the env file is also sourced by the lares CLI
# Random id that only tells installs apart (generated once, never derived from the machine).
if [[ $TELEMETRY == 1 ]] && ! grep -Eqx '[0-9a-f-]{36}' "$INSTALL_ID_FILE" 2>/dev/null; then
  (umask 077; cat /proc/sys/kernel/random/uuid > "$INSTALL_ID_FILE")
fi

# ---- systemd ------------------------------------------------------------------
step "$(L 'Tạo service systemd' 'Creating the systemd service')"
cat > /etc/systemd/system/lares.service <<UNIT
[Unit]
Description=Lares hosting control panel
After=network-online.target mariadb.service mysql.service nginx.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SRC/apps/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
# SIGHUP makes the panel reload its TLS certificate (e.g. after a Let's Encrypt renewal)
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable lares >/dev/null

# Upgrade: snapshot Lares's own state first (env/secret, certificates, SQLite, custom templates).
# Websites, their files and MySQL databases are never touched by an upgrade.
if [[ $UPGRADE == 1 && -f "$DATA_DIR/lares.db" ]]; then
  step "$(L 'Sao lưu dữ liệu Lares trước khi cập nhật' 'Backing up Lares data before upgrading')"
  BACKUP_DIR="$DATA_DIR/backups"
  install -d -m 700 "$BACKUP_DIR"
  systemctl stop lares 2>/dev/null || true   # consistent SQLite copy (WAL files included)
  BACKUP_FILE="$BACKUP_DIR/lares-$(date +%Y%m%d-%H%M%S).tar.gz"
  backup_paths=("${CONF_DIR#/}")   # relative to / (tar runs there); lares.db + its -wal/-shm files
  for f in "$DATA_DIR"/lares.db*; do [[ -e "$f" ]] && backup_paths+=("${f#/}"); done
  [[ -d "$DATA_DIR/templates" ]] && backup_paths+=("${DATA_DIR#/}/templates")
  (cd / && tar -czf "$BACKUP_FILE" "${backup_paths[@]}")
  chmod 600 "$BACKUP_FILE"
  ls -1t "$BACKUP_DIR"/lares-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f   # keep the 5 newest
  ok "$(L 'Đã sao lưu' 'Backed up to'): $BACKUP_FILE"
fi
systemctl restart lares
# The server creates the admin account before it starts listening, so a 401 from the API means it is ready.
ready=0
for _ in $(seq 1 30); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' "https://127.0.0.1:$LARES_PORT/api/auth/me" || true)
  [[ "$code" == 401 ]] && { ready=1; break; }
  sleep 1
done
[[ $ready == 1 ]] || { journalctl -u lares -n 40 --no-pager; die "$(L "Lares không khởi động được (không phản hồi trên port $LARES_PORT sau 30s)" "Lares failed to start (no response on port $LARES_PORT after 30s)")"; }
ok "$(L 'lares.service đang chạy' 'lares.service is running')"

# Admin CLI: sudo lares users | sudo lares reset-password [user]
CLI_SUDO_MSG=$(L 'Hãy chạy bằng sudo' 'Please run with sudo')
cat > /usr/local/bin/lares <<CLI
#!/bin/bash
[ "\$(id -u)" -eq 0 ] || { echo "$CLI_SUDO_MSG: sudo lares \$*"; exit 1; }
set -a; . $ENV_FILE; set +a
cd $SRC/apps/server && exec /usr/bin/node dist/cli.js "\$@"
CLI
chmod 755 /usr/local/bin/lares

if [[ -n "$ADMIN_PASS" ]]; then
  # Make sure the password we are about to print is really the one stored (bcrypt) in SQLite,
  # then drop the plaintext copy from the env file.
  /usr/local/bin/lares reset-password admin --password "$ADMIN_PASS" >/dev/null
  sed -i 's/^LARES_ADMIN_PASSWORD=.*/LARES_ADMIN_PASSWORD=/' "$ENV_FILE"
fi

# ---- Firewall -----------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  step "$(L 'Mở port firewall (ufw)' 'Opening firewall ports (ufw)')"
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow "$LARES_PORT/tcp" >/dev/null
  ok "ufw: 22, 80, 443, $LARES_PORT"
fi

# ---- Anonymous install counter (fire-and-forget, never fails the install) -------
# Sends exactly these fields - no IP is stored, no domains, no site data. See docs/*/installation.md.
send_ping() {
  [[ $TELEMETRY == 1 && -r "$INSTALL_ID_FILE" ]] || return 0
  local id ver os os_ver body
  id=$(tr -dc '0-9a-f-' < "$INSTALL_ID_FILE" | head -c 36 || true)
  ver=$(printf '%s' "$LARES_VERSION" | tr -dc '0-9A-Za-z.+-' | head -c 32 || true)
  os=$(printf '%s' "${ID:-unknown}" | tr -dc 'a-z0-9._-' | head -c 32 || true)
  os_ver=$(printf '%s' "${VERSION_ID:-}" | tr -dc '0-9A-Za-z._-' | head -c 16 || true)
  body=$(printf '{"install_id":"%s","version":"%s","event":"%s","os":"%s","os_version":"%s","arch":"%s","lang":"%s"}' \
    "$id" "$ver" "$1" "$os" "$os_ver" "$ARCH" "$LANG_UI")
  curl -fsS --max-time 3 -X POST -H 'Content-Type: application/json' --data "$body" "$TELEMETRY_URL" >/dev/null 2>&1 || true
}
send_ping "$([[ $UPGRADE == 1 ]] && echo upgrade || echo install)"

# ---- Done ---------------------------------------------------------------------
IP=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo -e "${c_green}==============================================================${c_off}"
if [[ $UPGRADE == 1 ]]; then
  echo -e "${c_green} $(L 'Lares đã được nâng cấp' 'Lares has been upgraded')${c_off} $(L '(website và database không bị thay đổi)' '(websites and databases were not changed)')"
  echo -e "  URL:  https://$IP:$LARES_PORT"
  [[ -n "${BACKUP_FILE:-}" ]] && echo -e "  $(L 'Bản sao lưu trước khi nâng cấp' 'Pre-upgrade backup'): $BACKUP_FILE"
else
  echo -e "${c_green} $(L 'Cài đặt Lares thành công!' 'Lares installed successfully!')${c_off}"
  echo -e "  URL:       https://$IP:$LARES_PORT   $(L '(chứng chỉ tự ký - trình duyệt sẽ cảnh báo)' '(self-signed certificate - your browser will warn)')"
  echo -e "  $(L 'Tài khoản: admin' 'Username:  admin')"
  echo -e "  $(L 'Mật khẩu: ' 'Password: ') $ADMIN_PASS"
  echo -e "  ${c_yellow}$(L 'Hãy lưu mật khẩu này và đổi ngay sau khi đăng nhập.' 'Save this password and change it right after logging in.')${c_off}"
fi
echo -e "  $(L 'Quên mật khẩu' 'Forgot password'): sudo lares reset-password"
echo -e "  Log:       journalctl -u lares -f"
echo -e "  ${c_yellow}$(L 'Bảo mật' 'Security'):${c_off}  $(L "port $LARES_PORT đang mở cho mọi IP - bật xác thực 2 lớp và giới hạn IP trong Cài đặt (hoặc: sudo lares allowlist add <IP-của-bạn>)" "port $LARES_PORT is open to every IP - enable two-factor auth and the IP allowlist in Settings (or: sudo lares allowlist add <your-IP>)")"
echo -e "  $(L 'Phiên bản' 'Version'):   $LARES_VERSION   $(L 'Tài liệu' 'Docs'): https://github.com/tampham92/lares/tree/main/docs"
if [[ $TELEMETRY == 1 ]]; then
  echo -e "  $(L 'Thống kê ẩn danh: bật (mã cài đặt ngẫu nhiên, phiên bản, HĐH - không IP/tên miền). Tắt: đặt LARES_TELEMETRY=0 trong' 'Anonymous stats: on (random install id, version, OS - no IPs/domains). Disable: set LARES_TELEMETRY=0 in') $ENV_FILE && systemctl restart lares"
fi
if [[ $COEXIST == 1 ]]; then
  echo
  echo -e "${c_yellow} $(L 'CHẾ ĐỘ CÙNG TỒN TẠI:' 'COEXIST MODE:')${c_off} $(L "port 80/443 đang do $WEB_FOREIGN giữ." "port 80/443 is held by $WEB_FOREIGN.")"
  echo -e "  $(L "Dùng mục 'Chuyển site' để chuyển các site về Lares. Khi đã sẵn sàng chuyển traffic:" "Use 'Migration' to move your sites to Lares. When you are ready to switch traffic:")"
  echo -e "    1. $(L 'Dừng & tắt web server cũ (vd: systemctl disable --now apache2 / lsws / nginx của panel cũ)' "Stop & disable the old web server (e.g. systemctl disable --now apache2 / lsws / the old panel's nginx)")"
  echo -e "    2. systemctl enable --now nginx"
  echo -e "    3. $(L 'Cài SSL cho từng site trong Lares' 'Install SSL for each site in Lares')"
fi
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo
  echo -e "${c_yellow} $(L 'Lưu ý:' 'Warnings:')${c_off}"
  for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo -e "${c_green}==============================================================${c_off}"
