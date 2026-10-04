# Lares Panel

**Lares Panel by [ThoCode](https://thocode.dev)** · English: [README.en.md](README.en.md)

Hosting control panel viết bằng TypeScript cho VPS Ubuntu/Debian: quản lý website **WordPress** và **Next.js** (cùng PHP thuần, HTML tĩnh), SSL, log traffic, database, và **chuyển site từ VPS/panel khác về**.

## Cài đặt

Trên VPS cần cài (Ubuntu 20.04/22.04/24.04, Debian 11/12), chạy bằng root:

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash
# tuỳ chọn:
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443 --php "8.3 8.2"
# bộ cài in tiếng Anh, panel mặc định tiếng Anh:
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en
```

`lares.thocode.dev/install` chuyển hướng tới `install.sh` trên GitHub. Nếu không truy cập được tên miền này, dùng link gốc: `https://raw.githubusercontent.com/tampham92/lares/main/install.sh`.

Script cài Nginx, MariaDB, PHP-FPM (nhiều phiên bản), Node.js LTS, Certbot, WP-CLI. Sau đó nó tải và build Lares, tạo service `lares` (systemd), rồi in ra URL `https://IP:8686` cùng mật khẩu admin. Chạy lại cùng lệnh để **nâng cấp**; dữ liệu và mật khẩu vẫn được giữ.

### Ngôn ngữ

Lares có **tiếng Việt** (mặc định) và **tiếng Anh**.

- `--lang vi|en` chọn ngôn ngữ của bộ cài và ngôn ngữ mặc định của panel (lưu thành `LARES_LANG` trong `/etc/lares/lares.env`, dùng cho log khởi động và lệnh `sudo lares`). Khi nâng cấp, ngôn ngữ đã lưu được giữ nếu không truyền `--lang`. `uninstall.sh` cũng nhận `--lang`.
- Giao diện web có nút chọn ngôn ngữ ở thanh bên và trang đăng nhập. Lần đầu mở, panel theo ngôn ngữ của trình duyệt (trình duyệt không dùng tiếng Việt hay tiếng Anh thì hiện tiếng Việt); lựa chọn được lưu trên trình duyệt đó.

### VPS đã có sẵn Nginx / MySQL / MariaDB / Apache

Installer **phát hiện và dùng lại** các dịch vụ đang có, không cài đè:

| Đang có | Cách xử lý |
|---|---|
| MariaDB / MySQL / Percona (cài qua apt hoặc do panel khác tự build) | Không cài server thứ hai; tạo user `lares` riêng. Đăng nhập quản trị qua unix socket, `/etc/mysql/debian.cnf`, hoặc `--mysql-root-password 'xxx'` nếu root có mật khẩu. Không xoá DB `test` hay user nào |
| nginx (apt) | Dùng lại; giữ nguyên vhost và site `default`. Bỏ qua catch-all nếu server đã có `default_server`. Nếu `nginx -t` đang lỗi thì dừng và yêu cầu sửa trước |
| Web server khác đang giữ port 80/443 (Apache, OpenLiteSpeed, nginx của aaPanel…) | **Chế độ cùng tồn tại**: vẫn cài nginx của Lares nhưng chưa chạy. Bạn vẫn tạo/chuyển site bình thường; khi sẵn sàng, dừng web server cũ và chạy `systemctl enable --now nginx` |
| PHP-FPM | Dùng lại, không sửa `php.ini` của các phiên bản đã có |
| Node.js cũ hơn 20 trong `/usr/bin` | Được nâng lên Node 22 (Lares cần ≥ 20). Node cài qua nvm không bị ảnh hưởng |

> Mặc định script lấy mã nguồn từ `https://github.com/tampham92/lares` (nhánh `main`). Muốn dùng fork hoặc nhánh khác: `--repo <git-url> --branch <nhánh>`, hoặc `--tarball <url .tar.gz>`.

### Cập nhật Lares có mất dữ liệu không?

Không. Chạy lại đúng lệnh cài đặt; installer nhận ra `/etc/lares/lares.env` nên chuyển sang chế độ **nâng cấp**:

- Chỉ thay mã nguồn trong `/opt/lares/src`, build lại, khởi động lại service `lares` (panel gián đoạn vài giây, **website vẫn chạy bình thường**).
- Giữ nguyên: website trong `/var/www`, database MySQL, vhost nginx, SSL, service Next.js, tài khoản admin, khoá giải mã và dữ liệu SQLite trong `/var/lib/lares`. Cấu trúc database của Lares được tự nâng cấp khi khởi động.
- Trước khi khởi động lại, installer tự sao lưu `/etc/lares` + database SQLite + template riêng vào `/var/lib/lares/backups/` (giữ 5 bản gần nhất).
- Đừng sửa trực tiếp file trong `/opt/lares/src` (bị ghi đè khi cập nhật); template riêng đặt ở `/var/lib/lares/templates/`.

### Tài khoản quản trị

`install.sh` in mật khẩu `admin` một lần duy nhất. Mật khẩu chỉ được lưu dưới dạng bcrypt trong `/var/lib/lares/lares.db`; bản gốc bị xoá khỏi `lares.env` ngay sau khi cài.

```bash
sudo lares users                       # liệt kê tài khoản
sudo lares reset-password              # đặt lại mật khẩu admin (ngẫu nhiên, in ra màn hình)
sudo lares reset-password admin --password 'MatKhauMoi123'
```

Đổi mật khẩu trên giao diện: **Cài đặt → Đổi mật khẩu quản trị**.

### Gỡ cài đặt

```bash
# Gỡ panel, GIỮ các website đang chạy (cài lại sẽ nhận lại site):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash

# Xoá sạch panel + mọi site, database, SSL, log do Lares tạo (hỏi xác nhận bằng cách gõ XOA; với --lang en thì gõ DELETE):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge
```

Cả hai chế độ đều không gỡ nginx/MariaDB/MySQL/PHP/Node.js, và không động vào site hay database không do Lares tạo (kể cả database "dùng chung" với panel khác).

## Tính năng

| Nhóm        | Chi tiết                                                                                                                                                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website      | Thêm/xoá/tạm ngưng site, alias, đổi phiên bản PHP. Loại site:**WordPress** (tự tải WP, tạo DB, wp-config, `wp core install` nếu nhập admin), **Next.js** (systemd service + Nginx reverse proxy, tự cấp port, clone từ Git, build/restart), PHP, HTML tĩnh                                              |
| Giao diện mẫu | Khi tạo site **WordPress** hoặc **HTML tĩnh**, chọn giao diện dựng sẵn (hiện có *Bất động sản* và *Doanh nghiệp*, xem trước ngay trong panel), chỉ cần nhập tên thương hiệu, SĐT, email, địa chỉ. HTML tĩnh: trang hoàn chỉnh, responsive, có lọc dự án và form liên hệ. WordPress: block theme riêng kèm nội dung mẫu thật (bài dự án có ảnh, trang Giới thiệu/Liên hệ, menu, trang chủ), sửa được trong wp-admin; tài khoản admin tạo tự động. Thêm mẫu riêng vào `/var/lib/lares/templates/` trên VPS (giữ nguyên khi cập nhật), xem [templates/README.md](templates/README.md) |
| Site không cần tên miền | Nhập `localhost` (hoặc để trống) thay cho tên miền: Lares tự cấp port (từ 8001), nginx lắng nghe port đó, truy cập qua `http://IP-VPS:8001`. Tự mở port trên ufw nếu đang bật. Khi giao diện đã xong, bấm **Gán tên miền thật** trong trang site: vhost chuyển sang tên miền, port được đóng, log traffic giữ nguyên, WordPress được đổi lại toàn bộ URL. Sau đó cài SSL (WordPress tự chuyển URL sang `https://`) |
| Nhân bản site | Tab **Nhân bản** trong trang site: tạo bản sao sang tên miền khác hoặc port mới (làm staging, thử plugin/giao diện). Sao chép toàn bộ thư mục site và database sang database mới (user/mật khẩu mới). WordPress: wp-config trỏ sang database mới, toàn bộ URL đổi sang địa chỉ mới. Laravel/PHP: cập nhật `DB_*`, `APP_URL` trong `.env`. Next.js: service riêng trên port nội bộ mới. Site nguồn không bị thay đổi, lỗi giữa chừng thì tự rollback |
| Viết bài AI (WordPress) | Tab **Viết bài AI** trong site WordPress: nhập chủ đề + từ khoá, AI (Claude, Gemini hoặc OpenAI/API tương thích) viết bài chuẩn SEO: tiêu đề ≤ 60 ký tự, slug, meta description, H2/H3, FAQ, liên kết nội bộ tới bài sẵn có. Xem trước, sửa, bảng kiểm tra SEO cập nhật trực tiếp, rồi lưu nháp hoặc đăng thẳng (kèm danh mục, thẻ, meta cho Yoast SEO / Rank Math). Cần wp-cli để đăng |
| Đăng nhập WP Admin một chạm | Nút **WP Admin** ở danh sách site và trang site: mở wp-admin đã đăng nhập sẵn (tài khoản administrator đầu tiên), không cần mật khẩu. Link dùng một lần, hết hạn sau 60 giây (mu-plugin `lares-sso.php`, token chỉ lưu dạng SHA-256 ngoài web root) |
| API key AI | **Cài đặt → AI viết bài**: chọn nhà cung cấp, model, nhập API key (mã hoá AES-256-GCM trong SQLite, không bao giờ trả về trình duyệt), nút kiểm tra kết nối |
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

### Khi panel nguồn chạy chung VPS với Lares

Lares nhận ra trường hợp này qua `machine-id` hoặc IP cục bộ, kể cả khi bạn nhập IP public của chính VPS:

- Bỏ SSH, làm việc trực tiếp trên máy. File được copy thẳng, không nén và không truyền qua mạng.
- Database mặc định được **dump sang database mới** để site cũ vẫn chạy song song. Nếu cùng một MySQL server, có thể chọn **dùng lại** database cũ (Lares kiểm tra `@@hostname/@@port/@@datadir`). Database dùng lại không bao giờ bị Lares xoá, và cũng không được search-replace để tránh làm hỏng site nguồn.
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

Nếu máy có nginx (`brew install nginx`), Lares tự chạy một **nginx dev** (không cần root) phục vụ các site chạy theo port, nên xem được site HTML tại `http://localhost:8001`. Site WordPress/PHP chỉ chạy thật trên VPS (cần PHP-FPM + MySQL).

Ngoài Linux, Lares luôn chạy chế độ dry-run: mọi lệnh thay đổi hệ thống (nginx reload, systemctl, certbot, mysql, chown) chỉ được **ghi log**, còn file site/vhost được ghi vào `./data`. Mật khẩu admin lần đầu được in ra log (hoặc đặt `LARES_ADMIN_PASSWORD`). Các biến cấu hình có trong [.env.example](.env.example).

## Cấu trúc

```
packages/shared      Zod schema + kiểu dữ liệu dùng chung server/web
apps/server          Fastify API (chạy bằng root trên VPS)
  src/executors      Chạy lệnh local / SSH (ssh2): stream, SFTP, huỷ, ghim host key
  src/services       nginx, php, mysql, sites, nodeapp (Next.js), wordpress, ssl, logs, tasks
  src/migration      panels/ (adapter + parser), appDetect, source (kết nối/quét), runner (pipeline), repo
  src/routes         REST + SSE
templates/           Giao diện mẫu: _base.css, _wp.css + <id>/{template.json, style.css, index.html, wordpress/home.html}
apps/web             React 19 + Vite + TanStack Query
install.sh           Bộ cài 1 lệnh
```

Nơi lưu trên VPS: dữ liệu `/var/lib/lares` (SQLite, secret), site `/var/www/<domain>/{public_html|app}`, log `/var/log/lares/sites/<domain>/`, vhost `/etc/nginx/sites-available/<domain>.conf`, service Next.js `lares-app-<domain>.service`.

## Bảo mật

- Mật khẩu SSH/DB nguồn, mật khẩu DB và biến môi trường Next.js được mã hoá AES-256-GCM trong SQLite.
- Mọi tham số shell đều được quote; tên miền, đường dẫn và excludes được validate bằng Zod ở cả server lẫn web.
- Code và dump SQL từ site migrate về được coi là **không tin cậy**: import SQL bằng user riêng của site (không dùng root), wp-cli/artisan/npm chạy bằng `www-data`, gỡ bit setuid/setgid, giải nén với `--no-same-owner`.
- Host key SSH được ghim sau lần *Kiểm tra kết nối*; nếu key đổi thì dừng lại.
- Trang quản trị chạy HTTPS (chứng chỉ tự ký, thay được qua `LARES_TLS_CERT/KEY`), đăng nhập có rate-limit, token SSE được che trong log.

## Giới hạn hiện tại

- Mọi site chạy chung user `www-data` (chưa tách user/PHP-FPM pool riêng cho từng site).
- Chuyển database chỉ hỗ trợ MySQL/MariaDB; site Next.js dùng DB ngoài (Postgres, Mongo...) cần tự chuyển DB đó.
- Biến môi trường bí mật của Next.js không nằm trong mã nguồn (ví dụ trong process manager của panel cũ) cần được nhập lại.
