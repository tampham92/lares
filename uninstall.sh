#!/usr/bin/env bash
# =============================================================================
#  Lares uninstaller
#
#  Gỡ panel, GIỮ các website đang chạy (mặc định):
#    curl -sSL https://lares.thocode.dev/uninstall | sudo bash
#
#  Xoá sạch: panel + mọi site/database/SSL/log do Lares tạo:
#    curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge
#
#  Không bao giờ gỡ nginx / MySQL / MariaDB / PHP / Node.js và không đụng tới site
#  không do Lares tạo. Gỡ các gói đó bằng apt nếu thật sự muốn.
#
#  English output: ... | sudo bash -s -- --lang en   (default: the panel's language, else vi)
# =============================================================================
set -Eeuo pipefail

INSTALL_DIR="/opt/lares"
DATA_DIR="/var/lib/lares"
CONF_DIR="/etc/lares"
ENV_FILE="$CONF_DIR/lares.env"
SITES_ROOT="/var/www"
# An install from before the rename to Lares that was never upgraded still lives under the TPanel names.
if [[ ! -e "$CONF_DIR" && -d /etc/tpanel ]]; then
  INSTALL_DIR="/opt/tpanel"; DATA_DIR="/var/lib/tpanel"; CONF_DIR="/etc/tpanel"; ENV_FILE="$CONF_DIR/tpanel.env"
fi

# ---- Language (vi | en) - resolved first so every message below is translated ---
# --lang wins, then the panel's LARES_LANG from $ENV_FILE, then vi.
LANG_ARG=""; prev=""
for a in "$@"; do
  case "$a" in --lang=*) LANG_ARG="${a#--lang=}" ;; esac
  [[ "$prev" == --lang ]] && LANG_ARG="$a"
  prev="$a"
done
LANG_UI="$LANG_ARG"
if [[ -z "$LANG_UI" && -r "$ENV_FILE" ]]; then
  LANG_UI=$(grep -E '^(LARES|TPANEL)_LANG=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)
fi
LANG_UI=$(printf '%s' "${LANG_UI:-vi}" | tr '[:upper:]' '[:lower:]'); LANG_UI="${LANG_UI:0:2}"
case "$LANG_UI" in
  vi|en) ;;
  *) [[ -n "$LANG_ARG" ]] && { echo "--lang: vi | en" >&2; exit 1; }; LANG_UI=vi ;;
esac
# L 'Tiếng Việt' 'English' -> the text for the chosen language
L() { if [[ $LANG_UI == en ]]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

usage() {
  if [[ $LANG_UI == en ]]; then
    cat <<'TXT'
Lares uninstaller

Remove the panel, KEEP the running websites (default):
  curl -sSL https://lares.thocode.dev/uninstall | sudo bash

Remove everything: the panel + every site/database/SSL/log Lares created:
  curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge

Options:
  --purge          Also delete everything Lares created (asks you to type DELETE)
  -y, --yes        Do not ask for confirmation
  --lang vi|en     Output language (default: the panel's language, else vi)
  -h, --help       Show this help

nginx / MySQL / MariaDB / PHP / Node.js are never removed, and sites Lares did not
create are never touched. Remove those packages with apt if you really want to.
TXT
  else
    cat <<'TXT'
Lares uninstaller

Gỡ panel, GIỮ các website đang chạy (mặc định):
  curl -sSL https://lares.thocode.dev/uninstall | sudo bash

Xoá sạch: panel + mọi site/database/SSL/log do Lares tạo:
  curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge

Tuỳ chọn:
  --purge          Xoá luôn mọi thứ Lares đã tạo (yêu cầu gõ XOA để xác nhận)
  -y, --yes        Không hỏi xác nhận
  --lang vi|en     Ngôn ngữ hiển thị (mặc định: ngôn ngữ của panel, nếu không có thì vi)
  -h, --help       Hiện trợ giúp này

Không bao giờ gỡ nginx / MySQL / MariaDB / PHP / Node.js và không đụng tới site
không do Lares tạo. Gỡ các gói đó bằng apt nếu thật sự muốn.
TXT
  fi
}

PURGE=0
ASSUME_YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge) PURGE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --lang) [[ $# -ge 2 ]] || { echo "--lang: vi | en" >&2; exit 1; }; shift 2 ;;   # read above
    --lang=*) shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "$(L 'Tham số không hợp lệ' 'Invalid option'): $1 ($(L 'xem' 'see') --help)"; exit 1 ;;
  esac
done

c_green='\033[0;32m'; c_yellow='\033[1;33m'; c_red='\033[0;31m'; c_blue='\033[0;34m'; c_off='\033[0m'
step() { echo -e "\n${c_blue}==>${c_off} $*"; }
ok()   { echo -e "${c_green}✔${c_off} $*"; }
warn() { echo -e "${c_yellow}!${c_off} $*"; }
die()  { echo -e "${c_red}✘ $*${c_off}" >&2; exit 1; }
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
TMP_CNF=""
trap '[[ -n "$TMP_CNF" ]] && rm -f "$TMP_CNF"' EXIT

[[ $EUID -eq 0 ]] || die "$(L 'Hãy chạy với quyền root (sudo)' 'Please run as root (sudo)')"
[[ -e "$ENV_FILE" || -d "$INSTALL_DIR" || -f /etc/systemd/system/lares.service ]] || die "$(L 'Không tìm thấy Lares trên máy này' 'Lares was not found on this machine')"

# `curl | bash` feeds the script through stdin, so questions must be asked on the terminal.
confirm() {
  [[ $ASSUME_YES == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "$(L 'Không có terminal để xác nhận - chạy lại với --yes' 'No terminal to confirm on - run again with --yes')"
  local answer
  read -r -p "$1 " answer </dev/tty
  [[ "$answer" == "$2" ]]
}

env_get() { [[ -f "$ENV_FILE" ]] && grep -E "^(LARES|TPANEL)_${1#LARES_}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

# ---- Inventory (read Lares's SQLite before the code that can read it is gone) -----
SITES=()      # domain \t root_path \t app_type \t ssl_type
DATABASES=()  # name \t username   (only databases Lares created: managed = 1)
DB_FILE="$DATA_DIR/lares.db"; [[ -f "$DB_FILE" ]] || DB_FILE="$DATA_DIR/tpanel.db"
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
    warn "$(L "Không đọc được CSDL của Lares - sẽ nhận diện site qua vhost nginx; database sẽ KHÔNG bị xoá" "Could not read Lares's database - sites will be detected from nginx vhosts; databases will NOT be deleted")"
  fi
  # Fallback / complement: vhosts carrying Lares's header
  for f in /etc/nginx/sites-available/*.conf; do
    [[ -f "$f" ]] && grep -qE '^# Managed by (Lares|TPanel)' "$f" || continue
    d=$(sed -n 's/^# site: \([^ ]*\) (.*/\1/p' "$f" | head -1)
    [[ -n "$d" ]] || continue
    known=0
    for s in "${SITES[@]+"${SITES[@]}"}"; do [[ "${s%%$'\t'*}" == "$d" ]] && known=1; done
    [[ $known == 1 ]] || SITES+=("$d"$'\t'"$SITES_ROOT/$d"$'\t'"?"$'\t'"")
  done
fi

# ---- Confirm ------------------------------------------------------------------
echo -e "${c_blue}Lares uninstaller${c_off}"
if [[ $PURGE == 0 ]]; then
  if [[ $LANG_UI == en ]]; then
    cat <<TXT
Will remove: the lares service, source code in $INSTALL_DIR, the panel certificate
Will keep:   every website (nginx vhosts, files, databases, SSL, Next.js services),
             the data in $DATA_DIR and $ENV_FILE (reinstalling Lares picks the sites up again)
TXT
  else
    cat <<TXT
Sẽ gỡ:     service lares, mã nguồn $INSTALL_DIR, chứng chỉ trang quản trị
Giữ lại:   toàn bộ website (vhost nginx, file, database, SSL, service Next.js),
           dữ liệu $DATA_DIR và $ENV_FILE (cài lại Lares sẽ nhận lại các site)
TXT
  fi
  confirm "$(L 'Tiếp tục? [y/N]' 'Continue? [y/N]')" "y" || die "$(L 'Đã huỷ' 'Cancelled')"
else
  CONFIRM_WORD=$(L XOA DELETE)
  echo -e "${c_red}$(L 'XOÁ SẠCH' 'PURGE')${c_off} - $(L 'panel và mọi thứ Lares đã tạo:' 'the panel and everything Lares created:')"
  echo "  ${#SITES[@]} website (file, vhost, log, SSL, $(L 'service Next.js' 'Next.js services')):"
  for s in "${SITES[@]+"${SITES[@]}"}"; do IFS=$'\t' read -r d root type _ <<<"$s"; echo "     - $d  ($root)"; done
  echo "  ${#DATABASES[@]} $(L 'database do Lares tạo:' 'database(s) created by Lares:')"
  for x in "${DATABASES[@]+"${DATABASES[@]}"}"; do echo "     - ${x%%$'\t'*}"; done
  echo "  $DATA_DIR, $CONF_DIR, /var/log/lares, $(L "user MySQL 'lares'" "MySQL user 'lares'")"
  echo "  $(L "(database 'dùng chung' với panel khác và site không do Lares tạo sẽ được giữ nguyên)" "(databases 'shared' with another panel and sites Lares did not create are kept)")"
  confirm "$(L "Thao tác KHÔNG thể hoàn tác. Gõ $CONFIRM_WORD để xác nhận:" "This CANNOT be undone. Type $CONFIRM_WORD to confirm:")" "$CONFIRM_WORD" || die "$(L 'Đã huỷ' 'Cancelled')"
fi

# ---- Panel service & code (both modes) ------------------------------------------
step "$(L 'Gỡ service lares' 'Removing the lares service')"
systemctl disable --now lares >/dev/null 2>&1 || true
systemctl disable --now tpanel >/dev/null 2>&1 || true
rm -f /etc/systemd/system/lares.service /etc/systemd/system/tpanel.service /usr/local/bin/lares /usr/local/bin/tpanel
systemctl daemon-reload
ok "$(L 'Đã dừng và gỡ lares.service' 'Stopped and removed lares.service')"

# ---- Purge: sites, databases, certificates ---------------------------------------
if [[ $PURGE == 1 ]]; then
  step "$(L 'Xoá website' 'Deleting websites')"
  for s in "${SITES[@]+"${SITES[@]}"}"; do
    IFS=$'\t' read -r domain root type ssl <<<"$s"
    [[ "$domain" =~ $DOMAIN_RE ]] || { warn "$(L 'Bỏ qua tên miền không hợp lệ' 'Skipping invalid domain'): $domain"; continue; }
    unit="tpanel-app-$domain"
    if [[ -f "/etc/systemd/system/$unit.service" ]]; then
      systemctl disable --now "$unit" >/dev/null 2>&1 || true
      rm -f "/etc/systemd/system/$unit.service"
    fi
    rm -f "/etc/nginx/sites-enabled/$domain.conf"
    grep -qsE '^# Managed by (Lares|TPanel)' "/etc/nginx/sites-available/$domain.conf" && rm -f "/etc/nginx/sites-available/$domain.conf"
    [[ "$ssl" == letsencrypt ]] && command -v certbot >/dev/null && certbot delete --cert-name "$domain" --non-interactive >/dev/null 2>&1 || true
    # Only ever delete a direct child of /var/www - guards against a corrupted DB row.
    real=$(readlink -f "$root" 2>/dev/null || echo "")
    if [[ -n "$real" && "$(dirname "$real")" == "$SITES_ROOT" && "$(basename "$real")" == "$domain" ]]; then
      rm -rf --one-file-system "$real"
    elif [[ -n "$real" && -e "$real" ]]; then
      warn "$domain: $(L "không xoá $real (nằm ngoài $SITES_ROOT/<domain>)" "not deleting $real (outside $SITES_ROOT/<domain>)")"
    fi
    ok "$domain"
  done
  systemctl daemon-reload

  if [[ ${#DATABASES[@]} -gt 0 ]]; then
    step "$(L 'Xoá database do Lares tạo' 'Deleting databases created by Lares')"
    TMP_CNF=$(mktemp); chmod 600 "$TMP_CNF"
    pw=$(env_get LARES_MYSQL_PASSWORD); pw=${pw//\\/\\\\}; pw=${pw//\"/\\\"}
    printf '[client]\nuser="%s"\npassword="%s"\n' "$(env_get LARES_MYSQL_USER)" "$pw" > "$TMP_CNF"
    sock=$(env_get LARES_MYSQL_SOCKET)
    if [[ -n "$sock" ]]; then echo "socket=$sock" >> "$TMP_CNF"; else echo "host=$(env_get LARES_MYSQL_HOST)" >> "$TMP_CNF"; echo "port=$(env_get LARES_MYSQL_PORT)" >> "$TMP_CNF"; fi
    for x in "${DATABASES[@]}"; do
      IFS=$'\t' read -r name user <<<"$x"
      [[ "$name" =~ ^[A-Za-z0-9_]{1,64}$ && "$user" =~ ^[A-Za-z0-9_]{1,32}$ ]] || { warn "$(L 'Bỏ qua tên không hợp lệ' 'Skipping invalid name'): $name"; continue; }
      if mysql --defaults-extra-file="$TMP_CNF" -e "DROP DATABASE IF EXISTS \`$name\`; DROP USER IF EXISTS '$user'@'localhost';" 2>/dev/null; then
        ok "$name"
      else
        warn "$(L 'Không xoá được database' 'Could not delete database') $name"
      fi
    done
  fi

  step "$(L 'Xoá cấu hình, dữ liệu và log của Lares' "Deleting Lares's configuration, data and logs")"
  rm -f /etc/nginx/conf.d/{00-lares,99-lares-default,00-tpanel,99-tpanel-default}.conf /etc/logrotate.d/{lares,tpanel}
  if command -v nginx >/dev/null && nginx -t >/dev/null 2>&1; then
    systemctl is-active --quiet nginx && systemctl reload nginx || true
  else
    warn "$(L 'nginx -t báo lỗi sau khi gỡ - kiểm tra lại cấu hình nginx' 'nginx -t reports errors after removal - check your nginx configuration')"
  fi
  # MySQL admin account last: it was needed to drop the site databases above.
  if command -v mysql >/dev/null; then
    # 'lares' on fresh installs, 'tpanel' on servers installed before the rename.
    MU=$(env_get LARES_MYSQL_USER); [[ "$MU" =~ ^[A-Za-z0-9_]{1,32}$ ]] || MU=lares
    mysql -e "DROP USER IF EXISTS '$MU'@'localhost'; DROP USER IF EXISTS '$MU'@'127.0.0.1';" 2>/dev/null \
      || { [[ -n "$TMP_CNF" ]] && mysql --defaults-extra-file="$TMP_CNF" -e "DROP USER IF EXISTS '$MU'@'127.0.0.1'; DROP USER IF EXISTS '$MU'@'localhost';" 2>/dev/null; } \
      || warn "$(L "Không xoá được user MySQL '$MU' - xoá thủ công" "Could not delete MySQL user '$MU' - drop it manually"): DROP USER '$MU'@'localhost';"
  fi
  rm -rf "$DATA_DIR" "$CONF_DIR" /var/log/lares /var/log/tpanel
  for link in /etc/tpanel /var/lib/tpanel; do [[ -L "$link" ]] && rm -f "$link"; done   # left by the TPanel -> Lares migration
  ok "$(L 'Đã xoá' 'Deleted') $DATA_DIR, $CONF_DIR, /var/log/lares"
else
  # Keep the sites alive: their vhosts reference $DATA_DIR/acme, /etc/lares/ssl and /etc/lares/apps.
  rm -f "$CONF_DIR/panel.crt" "$CONF_DIR/panel.key"
fi

step "$(L 'Xoá mã nguồn Lares' 'Deleting Lares source code')"
rm -rf "$INSTALL_DIR"
[[ -L /opt/tpanel ]] && rm -f /opt/tpanel
ok "$(L 'Đã xoá' 'Deleted') $INSTALL_DIR"

echo
echo -e "${c_green}==============================================================${c_off}"
echo -e "${c_green} $(L 'Đã gỡ Lares' 'Lares has been removed')${c_off}"
if [[ $PURGE == 0 ]]; then
  echo "  $(L 'Các website vẫn chạy. Dữ liệu còn lại' 'Websites keep running. Remaining data'): $DATA_DIR, $CONF_DIR"
  echo "  $(L 'Cài lại' 'Reinstall'): curl -sSL https://lares.thocode.dev/install | sudo bash"
  echo "  $(L 'Xoá sạch: chạy lại uninstall.sh với --purge' 'Remove everything: run uninstall.sh again with --purge')"
fi
echo "  $(L 'nginx, MariaDB/MySQL, PHP, Node.js được giữ nguyên. Muốn gỡ:' 'nginx, MariaDB/MySQL, PHP and Node.js are kept. To remove them:')"
echo "    apt purge nginx mariadb-server 'php*-fpm' nodejs certbot   $(L '(cẩn thận nếu còn site khác)' '(careful if other sites remain)')"
echo -e "${c_green}==============================================================${c_off}"
