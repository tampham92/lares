# Cài đặt, nâng cấp, gỡ cài đặt

[English](../en/installation.md) · [Mục lục tài liệu](../README.md)

## Yêu cầu

| | |
|---|---|
| Hệ điều hành | **Ubuntu 22.04 / 24.04** hoặc **Debian 12**, 64-bit (x86_64 hoặc arm64) |
| Quyền | root (hoặc user có `sudo`) qua SSH |
| RAM | Tối thiểu 1 GB, khuyên dùng 2 GB. Máy 1 GB nên thêm swap vì bước build cần nhiều RAM |
| Ổ đĩa | Khoảng 3 GB cho Lares và các gói, cộng dung lượng cho site và bản sao lưu |
| Mạng | Mở chiều vào các port **22** (SSH), **80** và **443** (website, Let's Encrypt), **8686** (panel, đổi được) |

Tốt nhất là cài trên VPS mới. VPS đã có nginx, MySQL/MariaDB hoặc panel khác vẫn cài được, xem
[README](../../README.md#vps-đã-có-sẵn-nginx--mysql--mariadb--apache).

### Hệ điều hành được hỗ trợ

| Hệ điều hành | Trạng thái |
|---|---|
| Ubuntu 22.04, Ubuntu 24.04, Debian 12 | Hỗ trợ chính thức (CI kiểm thử trên Ubuntu 22.04 và 24.04) |
| Debian 13 | Cài được, kèm cảnh báo "chưa kiểm thử" |
| Ubuntu mới hơn (vd 26.04) | Cài được, kèm cảnh báo "chưa kiểm thử" |
| Ubuntu 20.04, Debian 11 và cũ hơn | **Từ chối cài** vì đã hết vòng đời, không còn bản vá bảo mật. Thêm `--force-unsupported` nếu vẫn muốn cài (tự chịu rủi ro) |
| Bản phân phối khác | Từ chối cài. Có thể thử với `--force-unsupported`, nhưng vẫn cần apt-get |

## Cài đặt

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash
# bộ cài tiếng Anh, panel mặc định tiếng Anh:
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --lang en
```

`lares.thocode.dev/install` chuyển hướng tới `install.sh` trên GitHub. Nếu không truy cập được tên
miền này, dùng link gốc: `https://raw.githubusercontent.com/tampham92/lares/main/install.sh`.

Khi cài xong, installer in ra `https://<ip-vps>:8686`, tài khoản `admin` và một mật khẩu ngẫu nhiên.
Mật khẩu này **chỉ hiện một lần**. Panel dùng chứng chỉ tự ký nên trình duyệt sẽ cảnh báo, cho tới khi
bạn đặt [tên miền cho trang quản trị](security.md#tên-miền-cho-trang-quản-trị-và-chứng-chỉ-tin-cậy).

Việc cần làm ngay sau lần đăng nhập đầu tiên:

1. Đổi mật khẩu: **Cài đặt → Đổi mật khẩu quản trị**.
2. Bật xác thực 2 lớp và giới hạn IP, xem [Bảo mật](security.md).

### Tuỳ chọn

| Tuỳ chọn | Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|---|
| `--lang vi\|en` | `LARES_LANG` | `vi` | Ngôn ngữ của bộ cài và ngôn ngữ mặc định của panel |
| `--port <port>` | `LARES_PORT` | `8686` | Port HTTPS của panel. Khi nâng cấp, port đã lưu được giữ |
| `--php "<phiên bản>"` | `PHP_VERSIONS` | `"8.3 8.2 8.1 7.4"` | Các phiên bản PHP-FPM cần cài. Khi nâng cấp, danh sách đã lưu được giữ |
| `--node <major>` | `NODE_MAJOR` | `22` | Phiên bản Node.js, chỉ dùng khi chưa có `/usr/bin/node` hoặc bản đang có cũ hơn 20 |
| `--mysql-root-user <user>` | `MYSQL_ROOT_USER` | `root` | Tài khoản quản trị của MySQL/MariaDB đang có |
| `--mysql-root-password <mk>` | `MYSQL_ROOT_PASSWORD` | | Mật khẩu của tài khoản đó, khi không đăng nhập được qua socket |
| `--repo <url>` / `--branch <tên>` | `LARES_REPO` / `LARES_BRANCH` | GitHub `main` | Cài từ fork hoặc nhánh khác |
| `--tarball <url\|đường dẫn>` | `LARES_TARBALL` | | Cài từ file `.tar.gz` (https://, file:// hoặc đường dẫn trên máy) thay cho git |
| `--fresh-data` | | | Có dữ liệu cũ nhưng thiếu `/etc/lares/lares.env`: chuyển dữ liệu cũ sang chỗ khác rồi cài mới |
| `--no-telemetry` | `LARES_TELEMETRY=0` | bật | Tắt bộ đếm cài đặt ẩn danh, xem [Thống kê ẩn danh](#thống-kê-ẩn-danh-telemetry) |
| `--force-unsupported` | | | Vẫn cài trên HĐH đã hết vòng đời hoặc không được hỗ trợ (không có hỗ trợ) |

Ví dụ: `curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443 --php "8.3" --no-telemetry`

### Những gì được cài

Installer cài nginx, MariaDB (nếu máy chưa có MySQL/MariaDB), PHP-FPM, Node.js 22 (nếu cần), Certbot
và WP-CLI. Sau đó nó build Lares trong `/opt/lares/src`, tạo service systemd `lares` và lệnh quản trị
`sudo lares`. Nếu ufw đang bật, installer mở các port 22, 80, 443 và port của panel.

| Đường dẫn | Nội dung |
|---|---|
| `/etc/lares/lares.env` | Cấu hình và `LARES_SECRET`, khoá giải mã các mật khẩu đã lưu. Hãy giữ một bản sao |
| `/var/lib/lares/` | Database SQLite, thư mục ACME, template riêng, bản sao lưu trước khi nâng cấp |
| `/var/www/<domain>/` | Website |
| `/var/log/lares/sites/<domain>/` | Log truy cập và log lỗi nginx của từng site |
| `/var/backups/lares/` | Bản sao lưu site |

## Nâng cấp

Chạy lại lệnh cài đặt. Installer thấy `/etc/lares/lares.env` nên tự chuyển sang chế độ nâng cấp:

```bash
curl -sSL https://lares.thocode.dev/install | sudo bash
```

- Installer chỉ thay mã nguồn trong `/opt/lares/src` rồi build lại. Panel khởi động lại nên gián đoạn
  vài giây. **Website vẫn chạy bình thường.**
- Được giữ nguyên: site, database, vhost, SSL, tài khoản, cùng với ngôn ngữ, port, phiên bản PHP và
  lựa chọn thống kê ẩn danh đã lưu.
- Trước khi nâng cấp, installer sao lưu `/etc/lares`, database SQLite và template riêng vào
  `/var/lib/lares/backups/`, giữ 5 bản mới nhất. Xem [Sao lưu](backups.md#dữ-liệu-của-chính-lares).
- Mỗi ngày panel kiểm tra GitHub một lần. Khi có phiên bản mới, thanh bên hiện **Có bản mới x.y.z**
  kèm lệnh nâng cấp ở trên. Danh sách thay đổi nằm trong [CHANGELOG.md](../../CHANGELOG.md). Muốn
  tắt việc kiểm tra: đặt `LARES_UPDATE_CHECK=0` trong `/etc/lares/lares.env` rồi chạy
  `systemctl restart lares`.

Khi nâng cấp lên 0.2.0-beta, mọi người dùng bị đăng xuất một lần. Đây là điều bình thường, vì phiên
đăng nhập giờ có thể bị thu hồi.

## Gỡ cài đặt

```bash
# Gỡ panel, GIỮ các website đang chạy (cài lại thì Lares nhận lại các site):
curl -sSL https://lares.thocode.dev/uninstall | sudo bash
# Gỡ panel và xoá mọi site, database, chứng chỉ, log do Lares tạo:
curl -sSL https://lares.thocode.dev/uninstall | sudo bash -s -- --purge
# Không hỏi xác nhận (dùng trong script/CI): thêm --yes
```

Gỡ cài đặt không bao giờ gỡ nginx, MySQL/MariaDB, PHP hay Node.js, và không động vào site hay
database không do Lares tạo. Bản sao lưu site trong `/var/backups/lares` **luôn được giữ lại**, kể cả
khi dùng `--purge`. Tự xoá thư mục này khi không cần nữa.

## Thống kê ẩn danh (telemetry)

Để biết có bao nhiêu máy đang chạy Lares, và cần hỗ trợ phiên bản, hệ điều hành nào, installer và panel
gửi một ping ẩn danh rất nhỏ. **Ping chỉ gồm các trường sau:**

| Trường | Ví dụ | Ghi chú |
|---|---|---|
| `install_id` | `0b5c3f9e-2f4b-…` | UUID ngẫu nhiên, tạo một lần, lưu ở `/etc/lares/install-id`. Không suy ra từ phần cứng |
| `version` | `0.2.0-beta` | Phiên bản Lares |
| `event` | `install` / `upgrade` / `heartbeat` | |
| `os`, `os_version` | `ubuntu`, `24.04` | Lấy từ `/etc/os-release` |
| `arch` | `amd64` | Kiến trúc CPU |
| `lang` | `vi` | Ngôn ngữ mặc định của panel |

**Khi nào gửi:** `install.sh` gửi một lần khi cài hoặc nâng cấp thành công. Panel gửi tối đa một
heartbeat mỗi ngày khi đang chạy.

**Không bao giờ gửi:** địa chỉ IP (Worker nhận ping không đọc và không lưu IP), hostname, tên miền, số
lượng site, tên tài khoản hay bất kỳ thông tin nào về site của bạn.

**Cách gửi:** `POST https://lares.thocode.dev/ping`, timeout 3 giây. Nếu gửi lỗi thì bỏ qua, không bao
giờ làm hỏng việc cài đặt hay panel.

**Cách tắt:**

```bash
# khi cài hoặc nâng cấp
curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --no-telemetry
# hoặc tắt sau này, trên VPS
sudo sed -i 's/^LARES_TELEMETRY=.*/LARES_TELEMETRY=0/' /etc/lares/lares.env && sudo systemctl restart lares
```

Lựa chọn này được lưu và giữ qua các lần nâng cấp. Khi đã tắt, Lares không tạo mã cài đặt. Mã nguồn
liên quan để bạn tự kiểm tra: hàm `send_ping` trong `install.sh`, file
`apps/server/src/services/release.ts`, và Worker nhận dữ liệu trong `ops/telemetry-worker/`.
