#!/usr/bin/env bash
# =============================================================================
#  TPanel uninstaller
#
#  Gỡ panel, GIỮ các website đang chạy (mặc định):
#    curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/uninstall.sh | sudo bash
#
#  Xoá sạch: panel + mọi site/database/SSL/log do TPanel tạo:
#    curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/uninstall.sh | sudo bash -s -- --purge
#
#  Không bao giờ gỡ nginx / MySQL / MariaDB / PHP / Node.js và không đụng tới site
#  không do TPanel tạo. Gỡ các gói đó bằng apt nếu thật sự muốn.
# =============================================================================
set -Eeuo pipefail

PURGE=0
ASSUME_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,14p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Tham số không hợp lệ: $1"; exit 1 ;;
  esac
done

INSTALL_DIR="/opt/tpanel"
DATA_DIR="/var/lib/tpanel"
CONF_DIR="/etc/tpanel"
ENV_FILE="$CONF_DIR/tpanel.env"
SITES_ROOT="/var/www"

c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_blue='\033[0;34m'; c_off='\033[0m'
step() { echo -e "\n${c_blue}==>${c_off} $*"; }
ok()   { echo -e "${c_green}✔${c_off} $*"; }
warn() { echo -e "${c_yellow}!${c_off} $*"; }
die()  { echo -e "${c_red}✘ $*${c_off}" >&2; exit 1; }
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
TMP_CNF=""
trap '[[ -n "$TMP_CNF" ]] && rm -f "$TMP_CNF"' EXIT

[[ $EUID -eq 0 ]] || die "Hãy chạy với quyền root (sudo)"
[[ -e "$ENV_FILE" || -d "$INSTALL_DIR" || -f /etc/systemd/system/tpanel.service ]] || die "Không tìm thấy TPanel trên máy này"

# `curl | bash` feeds the script through stdin, so questions must be asked on the terminal.
confirm() {
  [[ $ASSUME_YES == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "Không có terminal để xác nhận - chạy lại với --yes"
  local answer
  read -r -p "$1 " answer </dev/tty
  [[ "$answer" == "$2" ]]
}

env_get() { [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

# ---- Inventory (read TPanel's SQLite before the code that can read it is gone) -----
SITES=()      # domain \t root_path \t app_type \t ssl_type
DATABASES=()  # name \t username   (only databases TPanel created: managed = 1)
DB_FILE="$DATA_DIR/tpanel.db"
SQLITE_MOD="$INSTALL_DIR/src/node_modules/better-sqlite3"
if [[ $PURGE == 1 && -f "$DB_FILE" ]]; then
  if [[ -x /usr/bin/node && -d "$SQLITE_MOD" ]]; then
    while IFS= read -r line; do
      case "$line" in
        SITE$'\t'*) SITES+=("${line#SITE$'\t'}") ;;
        DB$'\t'*) DATABASES+=("${line#DB$'\t'}") ;;
      esac
    done < <(/usr/bin/node -e '
      const Database = require(process.argv[1]);
      const db = new Database(process.argv[2], { readonly: true });
      for (const s of db.prepare("SELECT domain, root_path, app_type, ssl_json FROM sites").all()) {
        let ssl = ""; try { ssl = JSON.parse(s.ssl_json).type || ""; } catch {}
        console.log(["SITE", s.domain, s.root_path, s.app_type, ssl].join("\t"));
      }
      for (const d of db.prepare("SELECT name, username FROM databases WHERE managed = 1").all()) {
        console.log(["DB", d.name, d.username].join("\t"));
      }' "$SQLITE_MOD" "$DB_FILE" 2>/dev/null || true)
  else
    warn "Không đọc được CSDL của TPanel - sẽ nhận diện site qua vhost nginx; database sẽ KHÔNG bị xoá"
  fi
  # Fallback / complement: vhosts carrying TPanel's header
  for f in /etc/nginx/sites-available/*.conf; do
    [[ -f "$f" ]] && grep -q '^# Managed by TPanel' "$f" || continue
    d=$(sed -n 's/^# site: \([^ ]*\) (.*/\1/p' "$f" | head -1)
    [[ -n "$d" ]] || continue
    known=0
    for s in "${SITES[@]+"${SITES[@]}"}"; do [[ "${s%%$'\t'*}" == "$d" ]] && known=1; done
    [[ $known == 1 ]] || SITES+=("$d"$'\t'"$SITES_ROOT/$d"$'\t'"?"$'\t'"")
  done
fi

# ---- Confirm ------------------------------------------------------------------
echo -e "${c_blue}TPanel uninstaller${c_off}"
if [[ $PURGE == 0 ]]; then
  cat <<TXT
Sẽ gỡ:     service tpanel, mã nguồn $INSTALL_DIR, chứng chỉ trang quản trị
Giữ lại:   toàn bộ website (vhost nginx, file, database, SSL, service Next.js),
           dữ liệu $DATA_DIR và $ENV_FILE (cài lại TPanel sẽ nhận lại các site)
TXT
  confirm "Tiếp tục? [y/N]" "y" || die "Đã huỷ"
else
  echo -e "${c_red}XOÁ SẠCH${c_off} - panel và mọi thứ TPanel đã tạo:"
  echo "  ${#SITES[@]} website (file, vhost, log, SSL, service Next.js):"
  for s in "${SITES[@]+"${SITES[@]}"}"; do IFS=$'\t' read -r d root type _ <<<"$s"; echo "     - $d  ($root)"; done
  echo "  ${#DATABASES[@]} database do TPanel tạo:"
  for x in "${DATABASES[@]+"${DATABASES[@]}"}"; do echo "     - ${x%%$'\t'*}"; done
  echo "  $DATA_DIR, $CONF_DIR, /var/log/tpanel, user MySQL 'tpanel'"
  echo "  (database 'dùng chung' với panel khác và site không do TPanel tạo sẽ được giữ nguyên)"
  confirm "Thao tác KHÔNG thể hoàn tác. Gõ XOA để xác nhận:" "XOA" || die "Đã huỷ"
fi

# ---- Panel service & code (both modes) ------------------------------------------
step "Gỡ service tpanel"
systemctl disable --now tpanel >/dev/null 2>&1 || true
rm -f /etc/systemd/system/tpanel.service
systemctl daemon-reload
ok "Đã dừng và gỡ tpanel.service"

# ---- Purge: sites, databases, certificates ---------------------------------------
if [[ $PURGE == 1 ]]; then
  step "Xoá website"
  for s in "${SITES[@]+"${SITES[@]}"}"; do
    IFS=$'\t' read -r domain root type ssl <<<"$s"
    [[ "$domain" =~ $DOMAIN_RE ]] || { warn "Bỏ qua tên miền không hợp lệ: $domain"; continue; }
    unit="tpanel-app-$domain"
    if [[ -f "/etc/systemd/system/$unit.service" ]]; then
      systemctl disable --now "$unit" >/dev/null 2>&1 || true
      rm -f "/etc/systemd/system/$unit.service"
    fi
    rm -f "/etc/nginx/sites-enabled/$domain.conf"
    grep -qs '^# Managed by TPanel' "/etc/nginx/sites-available/$domain.conf" && rm -f "/etc/nginx/sites-available/$domain.conf"
    [[ "$ssl" == letsencrypt ]] && command -v certbot >/dev/null && certbot delete --cert-name "$domain" --non-interactive >/dev/null 2>&1 || true
    # Only ever delete a direct child of /var/www - guards against a corrupted DB row.
    real=$(readlink -f "$root" 2>/dev/null || echo "")
    if [[ -n "$real" && "$(dirname "$real")" == "$SITES_ROOT" && "$(basename "$real")" == "$domain" ]]; then
      rm -rf --one-file-system "$real"
    elif [[ -n "$real" && -e "$real" ]]; then
      warn "$domain: không xoá $real (nằm ngoài $SITES_ROOT/<domain>)"
    fi
    ok "$domain"
  done
  systemctl daemon-reload

  if [[ ${#DATABASES[@]} -gt 0 ]]; then
    step "Xoá database do TPanel tạo"
    TMP_CNF=$(mktemp); chmod 600 "$TMP_CNF"
    pw=$(env_get TPANEL_MYSQL_PASSWORD); pw=${pw//\\/\\\\}; pw=${pw//\"/\\\"}
    printf '[client]\nuser="%s"\npassword="%s"\n' "$(env_get TPANEL_MYSQL_USER)" "$pw" > "$TMP_CNF"
    sock=$(env_get TPANEL_MYSQL_SOCKET)
    if [[ -n "$sock" ]]; then echo "socket=$sock" >> "$TMP_CNF"; else echo "host=$(env_get TPANEL_MYSQL_HOST)" >> "$TMP_CNF"; echo "port=$(env_get TPANEL_MYSQL_PORT)" >> "$TMP_CNF"; fi
    for x in "${DATABASES[@]}"; do
      IFS=$'\t' read -r name user <<<"$x"
      [[ "$name" =~ ^[A-Za-z0-9_]{1,64}$ && "$user" =~ ^[A-Za-z0-9_]{1,32}$ ]] || { warn "Bỏ qua tên không hợp lệ: $name"; continue; }
      if mysql --defaults-extra-file="$TMP_CNF" -e "DROP DATABASE IF EXISTS \`$name\`; DROP USER IF EXISTS '$user'@'localhost';" 2>/dev/null; then
        ok "$name"
      else
        warn "Không xoá được database $name"
      fi
    done
  fi

  step "Xoá cấu hình, dữ liệu và log của TPanel"
  rm -f /etc/nginx/conf.d/00-tpanel.conf /etc/nginx/conf.d/99-tpanel-default.conf /etc/logrotate.d/tpanel
  if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then
    systemctl is-active --quiet nginx && systemctl reload nginx || true
  else
    warn "nginx -t báo lỗi sau khi gỡ - kiểm tra lại cấu hình nginx"
  fi
  # MySQL admin account last: it was needed to drop the site databases above.
  if command -v mysql >/dev/null; then
    mysql -e "DROP USER IF EXISTS 'tpanel'@'localhost'; DROP USER IF EXISTS 'tpanel'@'127.0.0.1';" 2>/dev/null \
      || { [[ -n "$TMP_CNF" ]] && mysql --defaults-extra-file="$TMP_CNF" -e "DROP USER IF EXISTS 'tpanel'@'127.0.0.1'; DROP USER IF EXISTS 'tpanel'@'localhost';" 2>/dev/null; } \
      || warn "Không xoá được user MySQL 'tpanel' - xoá thủ công: DROP USER 'tpanel'@'localhost';"
  fi
  rm -rf "$DATA_DIR" "$CONF_DIR" /var/log/tpanel
  ok "Đã xoá $DATA_DIR, $CONF_DIR, /var/log/tpanel"
else
  # Keep the sites alive: their vhosts reference $DATA_DIR/acme, /etc/tpanel/ssl and /etc/tpanel/apps.
  rm -f "$CONF_DIR/panel.crt" "$CONF_DIR/panel.key"
fi

step "Xoá mã nguồn TPanel"
rm -rf "$INSTALL_DIR"
ok "Đã xoá $INSTALL_DIR"

echo
echo -e "${c_green}==============================================================${c_off}"
echo -e "${c_green} Đã gỡ TPanel${c_off}"
if [[ $PURGE == 0 ]]; then
  echo "  Các website vẫn chạy. Dữ liệu còn lại: $DATA_DIR, $CONF_DIR"
  echo "  Cài lại: curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash"
  echo "  Xoá sạch: chạy lại uninstall.sh với --purge"
fi
echo "  nginx, MariaDB/MySQL, PHP, Node.js được giữ nguyên. Muốn gỡ:"
echo "    apt purge nginx mariadb-server 'php*-fpm' nodejs certbot   (cẩn thận nếu còn site khác)"
echo -e "${c_green}==============================================================${c_off}"
