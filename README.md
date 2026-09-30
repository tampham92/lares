# TPanel

Hosting control panel viết bằng TypeScript cho VPS Ubuntu/Debian: quản lý website **WordPress** và **Next.js** (cùng PHP thuần, HTML tĩnh), SSL, log traffic, database, và **chuyển site từ VPS/panel khác về**.

## Cài đặt

Trên VPS cần cài (Ubuntu 20.04/22.04/24.04, Debian 11/12), chạy bằng root:

```bash
curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash
# tuỳ chọn:
curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/install.sh | sudo bash -s -- --port 9443 --php "8.3 8.2"
```

Script cài Nginx, MariaDB, PHP-FPM (nhiều phiên bản), Node.js LTS, Certbot, WP-CLI. Sau đó nó tải và build TPanel, tạo service `tpanel` (systemd), rồi in ra URL `https://IP:8686` cùng mật khẩu admin. Chạy lại cùng lệnh để **nâng cấp**; dữ liệu và mật khẩu vẫn được giữ.

### VPS đã có sẵn Nginx / MySQL / MariaDB / Apache

Installer **phát hiện và dùng lại** các dịch vụ đang có, không cài đè:

| Đang có | Cách xử lý |
|---|---|
| MariaDB / MySQL / Percona (cài qua apt hoặc do panel khác tự build) | Không cài server thứ hai; tạo user `tpanel` riêng. Đăng nhập quản trị qua unix socket, `/etc/mysql/debian.cnf`, hoặc `--mysql-root-password 'xxx'` nếu root có mật khẩu. Không xoá DB `test` hay user nào |
| nginx (apt) | Dùng lại; giữ nguyên vhost và site `default`. Bỏ qua catch-all nếu server đã có `default_server`. Nếu `nginx -t` đang lỗi thì dừng và yêu cầu sửa trước |
| Web server khác đang giữ port 80/443 (Apache, OpenLiteSpeed, nginx của aaPanel…) | **Chế độ cùng tồn tại**: vẫn cài nginx của TPanel nhưng chưa chạy. Bạn vẫn tạo/chuyển site bình thường; khi sẵn sàng, dừng web server cũ và chạy `systemctl enable --now nginx` |
| PHP-FPM | Dùng lại, không sửa `php.ini` của các phiên bản đã có |
| Node.js cũ hơn 20 trong `/usr/bin` | Được nâng lên Node 22 (TPanel cần ≥ 20). Node cài qua nvm không bị ảnh hưởng |

> Mặc định script lấy mã nguồn từ `https://github.com/tampham92/tpanel` (nhánh `main`). Muốn dùng fork hoặc nhánh khác: `--repo <git-url> --branch <nhánh>`, hoặc `--tarball <url .tar.gz>`.

### Tài khoản quản trị

`install.sh` in mật khẩu `admin` một lần duy nhất. Mật khẩu chỉ được lưu dưới dạng bcrypt trong `/var/lib/tpanel/tpanel.db`; bản gốc bị xoá khỏi `tpanel.env` ngay sau khi cài.

```bash
sudo tpanel users                       # liệt kê tài khoản
sudo tpanel reset-password              # đặt lại mật khẩu admin (ngẫu nhiên, in ra màn hình)
sudo tpanel reset-password admin --password 'MatKhauMoi123'
```

Đổi mật khẩu trên giao diện: **Cài đặt → Đổi mật khẩu quản trị**.

### Gỡ cài đặt

```bash
# Gỡ panel, GIỮ các website đang chạy (cài lại sẽ nhận lại site):
curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/uninstall.sh | sudo bash

# Xoá sạch panel + mọi site, database, SSL, log do TPanel tạo (hỏi xác nhận bằng cách gõ XOA):
curl -sSL https://raw.githubusercontent.com/tampham92/tpanel/main/uninstall.sh | sudo bash -s -- --purge
```

Cả hai chế độ đều không gỡ nginx/MariaDB/MySQL/PHP/Node.js, và không động vào site hay database không do TPanel tạo (kể cả database "dùng chung" với panel khác).

## Tính năng

| Nhóm        | Chi tiết                                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website      | Thêm/xoá/tạm ngưng site, alias, đổi phiên bản PHP. Loại site:**WordPress** (tự tải WP, tạo DB, wp-config, `wp core install` nếu nhập admin), **Next.js** (systemd service + Nginx reverse proxy, tự cấp port, clone từ Git, build/restart), PHP, HTML tĩnh                                              |
| Next.js      | Không cần database; dữ liệu JSON nằm trong thư mục app và được giữ nguyên khi deploy lại. Tự nhận npm/yarn/pnpm theo lockfile, cho sửa lệnh install/build/start, biến môi trường (`.env.production.local`, giá trị được mã hoá trong DB), xem log ứng dụng (journald)                                  |
| SSL          | Let's Encrypt (HTTP-01 webroot dùng chung, chạy được cả với site proxy Next.js), bao gồm alias, staging, gia hạn; hoặc upload certificate riêng (kiểm tra key có khớp cert). Bật/tắt bắt buộc HTTPS + HSTS, cảnh báo khi DNS chưa trỏ về hoặc cert sắp hết hạn                                               |
| Log traffic  | Access/error log riêng cho từng site. Thống kê theo 1h/24h/7 ngày/30 ngày: số request, IP duy nhất, băng thông, thời gian phản hồi trung bình, 2xx–5xx, biểu đồ theo giờ/ngày, top URL/IP/referrer/user-agent (đọc được cả log đã xoay vòng`.gz`). Có tail + lọc, tải về, xoá, cấu hình logrotate |
| Database     | Tạo/xoá database MySQL/MariaDB; mật khẩu được mã hoá và chỉ hiện khi bấm                                                                                                                                                                                                                                                   |
| Chuyển site | Xem phần dưới                                                                                                                                                                                                                                                                                                                        |

## Chuyển site từ VPS / panel khác

**Chuyển site** → nhập VPS nguồn (IP, SSH user, mật khẩu hoặc private key, sudo), chọn panel nguồn → **Quét site** → chọn site và tuỳ chỉnh → **Bắt đầu**.

Panel được hỗ trợ và tự nhận diện: **aaPanel, CyberPanel, HestiaCP/VestaCP, cPanel, DirectAdmin, CloudPanel, Plesk, Webinoly**, VPS thuần Nginx/Apache, hoặc nhập thủ công.

Với mỗi site:

1. **Chuẩn bị**: kiểm tra thư mục nguồn, tên miền đích, đăng nhập DB nguồn, ước lượng dung lượng, chọn cách truyền.
2. **Dump & nén database**: `mysqldump --single-transaction --routines --triggers | pigz/gzip`. Nếu user không có quyền dump routine thì tự dump lại mà không kèm routine.
3. **Nén mã nguồn**: `tar | gzip`, bỏ qua các đường dẫn trong excludes (`wp-content/cache`, `node_modules`, `.next`, addon domain lồng bên trong...).
4. **Đồng bộ**: *archive* (nén trên nguồn → SFTP, kiểm tra sha256) hoặc *stream* (nén và truyền thẳng qua SSH, không cần chỗ trống trên nguồn). Chế độ *auto* chọn theo dung lượng trống.
5. **Kiểm tra toàn vẹn**: sha256, `gzip -t`, file dump phải có dòng `Dump completed`.
6. **Tạo site, khôi phục file, import DB** vào database mới với user riêng của site. Tự bỏ `DEFINER` và đổi collation MySQL 8 ↔ MariaDB.
7. **Cấu hình lại**: sửa `DB_*` trong `wp-config.php`/`.env`, search-replace tên miền WordPress bằng wp-cli nếu đổi domain. Với Next.js: install, build rồi chạy service.
8. **Hoàn tất & dọn dẹp**: phân quyền, reload nginx, xoá file tạm ở cả hai phía (file chứa mật khẩu DB luôn bị xoá). Nếu lỗi, tự **rollback** site/DB vừa tạo.

Tiến trình được cập nhật realtime (SSE), có huỷ và chạy lại các site lỗi. Dữ liệu trên nguồn **không bị thay đổi**.

### Khi panel nguồn chạy chung VPS với TPanel

TPanel nhận ra trường hợp này qua `machine-id` hoặc IP cục bộ, kể cả khi bạn nhập IP public của chính VPS:

- Bỏ SSH, làm việc trực tiếp trên máy. File được copy thẳng, không nén và không truyền qua mạng.
- Database mặc định được **dump sang database mới** để site cũ vẫn chạy song song. Nếu cùng một MySQL server, có thể chọn **dùng lại** database cũ (TPanel kiểm tra `@@hostname/@@port/@@datadir`). Database dùng lại không bao giờ bị TPanel xoá, và cũng không được search-replace để tránh làm hỏng site nguồn.
- Cảnh báo khi port 80 đang do web server của panel cũ giữ (ví dụ OpenLiteSpeed của CyberPanel, nginx của aaPanel), hoặc khi có nguy cơ trùng `server_name`.
- Webinoly để `wp-config.php` bên ngoài `htdocs`: file này được tự mang vào thư mục site.

## Phát triển

```bash
npm install
npm run dev          # server :8686 (tsx watch) + web :5173 (Vite, proxy /api)
npm test             # unit test parser (nginx/apache/cPanel/Hestia, wp-config, .env, access log)
npm run typecheck
npm run build
```

Trên macOS/không phải Linux, `TPANEL_DRY_RUN=1` là mặc định: mọi lệnh thay đổi hệ thống (nginx reload, systemctl, certbot, mysql, chown) chỉ được **ghi log**, còn file site/vhost được ghi vào `./data`. Mật khẩu admin lần đầu được in ra log (hoặc đặt `TPANEL_ADMIN_PASSWORD`). Các biến cấu hình có trong [.env.example](.env.example).

## Cấu trúc

```
packages/shared      Zod schema + kiểu dữ liệu dùng chung server/web
apps/server          Fastify API (chạy bằng root trên VPS)
  src/executors      Chạy lệnh local / SSH (ssh2): stream, SFTP, huỷ, ghim host key
  src/services       nginx, php, mysql, sites, nodeapp (Next.js), wordpress, ssl, logs, tasks
  src/migration      panels/ (adapter + parser), appDetect, source (kết nối/quét), runner (pipeline), repo
  src/routes         REST + SSE
apps/web             React 19 + Vite + TanStack Query
install.sh           Bộ cài 1 lệnh
```

Nơi lưu trên VPS: dữ liệu `/var/lib/tpanel` (SQLite, secret), site `/var/www/<domain>/{public_html|app}`, log `/var/log/tpanel/sites/<domain>/`, vhost `/etc/nginx/sites-available/<domain>.conf`, service Next.js `tpanel-app-<domain>.service`.

## Bảo mật

- Mật khẩu SSH/DB nguồn, mật khẩu DB và biến môi trường Next.js được mã hoá AES-256-GCM trong SQLite.
- Mọi tham số shell đều được quote; tên miền, đường dẫn và excludes được validate bằng Zod ở cả server lẫn web.
- Code và dump SQL từ site migrate về được coi là **không tin cậy**: import SQL bằng user riêng của site (không dùng root), wp-cli/artisan/npm chạy bằng `www-data`, gỡ bit setuid/setgid, giải nén với `--no-same-owner`.
- Host key SSH được ghim sau lần *Kiểm tra kết nối*; nếu key đổi thì dừng lại.
- Trang quản trị chạy HTTPS (chứng chỉ tự ký, thay được qua `TPANEL_TLS_CERT/KEY`), đăng nhập có rate-limit, token SSE được che trong log.

## Giới hạn hiện tại

- Mọi site chạy chung user `www-data` (chưa tách user/PHP-FPM pool riêng cho từng site).
- Chuyển database chỉ hỗ trợ MySQL/MariaDB; site Next.js dùng DB ngoài (Postgres, Mongo...) cần tự chuyển DB đó.
- Biến môi trường bí mật của Next.js không nằm trong mã nguồn (ví dụ trong process manager của panel cũ) cần được nhập lại.
