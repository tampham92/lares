# Xử lý sự cố

[English](../en/troubleshooting.md) · [Mục lục tài liệu](../README.md)

## Log nằm ở đâu

| Thành phần | Vị trí |
|---|---|
| Panel (API, task, lỗi khởi động) | `journalctl -u lares -n 200 --no-pager` (xem trực tiếp: `journalctl -u lares -f`) |
| Traffic và lỗi nginx của site | `/var/log/lares/sites/<domain>/access.log`, `error.log` (xem được ở tab **Log** của site) |
| nginx | `sudo nginx -t`, `/var/log/nginx/error.log`, `journalctl -u nginx` |
| PHP-FPM | `journalctl -u php8.3-fpm` (thay bằng phiên bản của bạn), `/var/log/php8.3-fpm.log` |
| Ứng dụng Next.js | `journalctl -u lares-app-<domain>` (xem được trong phần log ứng dụng của site) |
| Let's Encrypt | `/var/log/letsencrypt/letsencrypt.log` |
| MySQL / MariaDB | `journalctl -u mariadb` (hoặc `mysql`) |
| Chuyển site | Trang chi tiết của lần chuyển site (log riêng cho từng site). File tạm nằm ở `/var/lib/lares/migrations` |
| Installer | Hiện trên terminal. Muốn lưu lại: `curl -sSL https://lares.thocode.dev/install \| sudo bash 2>&1 \| tee install.log` |

## Không vào được panel

Kiểm tra lần lượt, bắt đầu từ chính VPS:

```bash
systemctl status lares                        # service có chạy không?
journalctl -u lares -n 100 --no-pager         # nếu không chạy thì vì sao?
curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8686/api/auth/me   # 401 = panel chạy bình thường
ss -ltnp | grep 8686                          # có lắng nghe port không? (hoặc port --port của bạn)
```

- **Trên VPS trả về 401 nhưng từ ngoài không vào được**: do firewall. Kiểm tra `sudo ufw status` và
  firewall (security group) của nhà cung cấp VPS.
- **Dùng `https://`**, không phải `http://`. Trình duyệt cảnh báo chứng chỉ là bình thường khi panel
  còn dùng chứng chỉ tự ký.
- **Bị chặn trước cả trang đăng nhập**: IP hiện tại của bạn không có trong danh sách giới hạn IP. Chạy
  `sudo lares allowlist show`, rồi `sudo lares allowlist add <ip-của-bạn>` (hoặc `clear` để xoá danh
  sách). Hoặc vào qua SSH tunnel: `ssh -L 8686:127.0.0.1:8686 root@VPS` rồi mở
  `https://127.0.0.1:8686`.
- **Mất thiết bị 2FA**: chạy `sudo lares disable-2fa [user]`.
- **Quên mật khẩu hoặc tài khoản bị khoá**: chạy `sudo lares reset-password [user]`. Lệnh này cũng mở
  khoá tài khoản.
- **Tên miền của panel không vào được nữa**: kiểm tra DNS còn trỏ về VPS không, và bản ghi trên
  Cloudflare có đang là đám mây xám không. Bạn luôn có thể vào bằng `https://<ip>:8686` (sẽ có cảnh
  báo chứng chỉ).
- **Service liên tục khởi động lại sau khi nâng cấp**: đọc `journalctl -u lares`, rồi chạy lại lệnh
  cài đặt. Nếu vẫn lỗi, khôi phục bản sao lưu trước khi nâng cấp, xem
  [Sao lưu](backups.md#dữ-liệu-của-chính-lares).

## `nginx -t` báo lỗi

```bash
sudo nginx -t        # chỉ ra file và dòng bị lỗi
```

- Vhost do Lares tạo là `/etc/nginx/sites-available/<domain>.conf`, dòng đầu là `# Managed by Lares`.
  Lares tự tạo lại các file này, nên đừng sửa tay.
- **duplicate default server / conflicting server name**: một vhost khác (thường là của panel cũ,
  hoặc site `default` của nginx) dùng cùng `server_name` hoặc cùng `default_server`. Xoá hoặc đổi tên
  vhost bị trùng.
- **cannot load certificate**: vhost trỏ tới một chứng chỉ đã bị xoá. Cài lại SSL cho site đó, hoặc
  bỏ các dòng `ssl_certificate` trong vhost kia.
- **duplicate "real_ip_header"**: một panel khác đã đặt chỉ thị này. Tắt **IP thật Cloudflare** trong
  Cài đặt, hoặc xoá chỉ thị kia.
- Installer từ chối chạy khi `nginx -t` đang lỗi sẵn, vì nó không phân biệt được lỗi có sẵn với lỗi do
  chính nó gây ra. Hãy sửa cấu hình trước.
- **Port 80/443 đang bị chiếm** bởi Apache, OpenLiteSpeed hoặc nginx của panel khác: Lares đã cài
  nginx ở *chế độ cùng tồn tại* và để nginx dừng. Kiểm tra bằng `ss -ltnp 'sport = :80'`. Khi sẵn
  sàng, dừng web server cũ rồi chạy `systemctl enable --now nginx`.

## Lỗi cài SSL

Let's Encrypt phải truy cập được `http://<domain>/.well-known/acme-challenge/…` trên **chính VPS này**.

1. **DNS**: `dig +short example.com A` và `dig +short example.com AAAA` phải trả về VPS này. Bản ghi
   AAAA (IPv6) cũ còn sót là nguyên nhân rất hay gặp: hãy xoá nó hoặc trỏ nó về đây. Kiểm tra như vậy
   cho cả mọi alias (vd `www`).
2. **Port 80** mở từ Internet (ufw và firewall của nhà cung cấp), và nginx đang chạy (không ở chế độ
   cùng tồn tại).
3. **Thử đường dẫn**: `curl -i http://example.com/.well-known/acme-challenge/test` phải trả về
   **404 của nginx**. Nếu bị chuyển hướng sang server khác, gặp lỗi Cloudflare hay timeout thì
   Let's Encrypt cũng sẽ thất bại.
4. **Cloudflare**: HTTP-01 vẫn hoạt động qua proxy của Cloudflare. Nhưng "Always Use HTTPS" đi cùng
   chế độ SSL Full/Strict có thể làm hỏng lần cấp chứng chỉ đầu tiên. Khi cấp chứng chỉ, chuyển bản ghi
   sang đám mây xám hoặc tắt tuỳ chọn đó, rồi bật lại sau.
5. **Giới hạn số lần**: thử quá nhiều lần cho cùng một tên miền sẽ chạm giới hạn của Let's Encrypt. Dùng
   tuỳ chọn **staging** khi đang thử nghiệm, và đọc lý do chính xác trong
   `/var/log/letsencrypt/letsencrypt.log`.

## Lỗi chuyển site

Mở trang chi tiết của lần chuyển site: mỗi site có log riêng. Site nào lỗi sẽ được tự rollback, còn dữ
liệu trên máy nguồn không bao giờ bị thay đổi. Sửa nguyên nhân rồi bấm **Chạy lại các site lỗi**.

- **Lỗi kết nối hoặc xác thực SSH**: kiểm tra IP, port, user, mật khẩu hoặc key, và mật khẩu sudo.
  Firewall của máy nguồn phải cho VPS này kết nối SSH.
- **Host key thay đổi**: SSH key của máy nguồn khác với key đã ghim. Kiểm tra đúng là cùng một máy chủ,
  rồi bấm *Kiểm tra kết nối* lại.
- **Lỗi dump database**: thông tin DB của máy nguồn (lấy từ `wp-config.php` / `.env`) phải dùng được
  trên máy nguồn. Nếu user không có quyền dump routine, Lares tự dump lại mà không kèm routine.
- **Thiếu dung lượng**: kiểm tra `df -h` trên cả hai máy. Lares để file tạm ở
  `/var/lib/lares/migrations`. Nếu máy nguồn đã đầy, chọn chế độ truyền **stream** (không tạo file tạm
  trên máy nguồn).
- **Site chạy được nhưng vẫn hiện bản trên máy cũ**: DNS vẫn trỏ về máy cũ. Cập nhật bản ghi DNS rồi
  cài SSL.
- **Next.js build lỗi**: xem log build trong trang chuyển site và log ứng dụng. Các biến môi trường bí
  mật nằm ngoài mã nguồn (ví dụ trong PM2) cần được nhập lại.

## Cloudflare: vòng lặp chuyển hướng sau khi bật proxy

Giữ bản ghi ở chế độ **DNS only** (đám mây xám) cho tới khi cài xong SSL. Trước khi bật proxy (đám mây cam), đặt **SSL/TLS → Full (strict)** trong Cloudflare. Chế độ Flexible kèm "Bắt buộc HTTPS" sẽ gây vòng lặp chuyển hướng. Zone ở trạng thái "pending" nghĩa là nameserver chưa chuyển sang Cloudflare.

## Adminer không mở được

Lần đầu mở, Lares tải Adminer từ github.com và kiểm tra SHA-256, nên VPS cần truy cập được github.com. Adminer cần một phiên bản PHP-FPM có `mysqli` đã cài sẵn. Ở chế độ cùng tồn tại (nginx đang tắt), Adminer không chạy được.

## Next.js: lỗi build hoặc lỗi Git clone

- **Repo private trên GitHub**: kết nối GitHub một lần trong **Cài đặt → Tích hợp → GitHub** (Lares
  tự tạo GitHub App riêng, rồi bạn chọn các repo App được đọc). Sau đó form tạo site sẽ liệt kê repo
  và branch. "Không thấy repo?" nghĩa là App chưa được cấp quyền repo đó.
- **Repo private ở nơi khác**: dùng URL `https://` và điền **Access token** khi tạo site (hoặc sau đó trong
  **Cấu hình build**). Trên GitHub, tạo fine-grained token chỉ cho repo đó với quyền
  **Contents: Read-only**. GitLab dùng project access token có `read_repository`; Bitbucket dùng
  repository access token (hoặc `username:app-password`). Token được mã hoá khi lưu và không bao giờ
  nằm trong URL clone, `.git/config` hay log tác vụ. Đừng dán token vào chính Git URL.
- **`Cannot find module '@tailwindcss/postcss'`** (hoặc một devDependency khác): đã sửa ở phiên bản
  này; bước cài đặt không còn nhận `NODE_ENV=production` của panel nên devDependencies được cài đủ.
  Bấm lại **Build & khởi động**.

## Có địa chỉ IPv6 nhưng IPv6 không hoạt động

Một số VPS được cấp địa chỉ IPv6 nhưng không ra được Internet qua IPv6 (`curl -6 https://www.google.com`
lỗi trong khi `curl -4` chạy được). Phần lớn công cụ tự chuyển sang IPv4, nhưng không phải tất cả:
`next build` sẽ lỗi "Failed to fetch … from Google Fonts", và Let's Encrypt (ưu tiên IPv6) sẽ thất bại
nếu có bản ghi AAAA. Installer tự phát hiện trường hợp này và thêm `precedence ::ffff:0:0/96  100` vào
`/etc/gai.conf` để hệ thống ưu tiên IPv4; panel cũng không dùng địa chỉ IPv6 đó cho bản ghi DNS nữa.
Đừng tắt IPv6 bằng sysctl: nginx lắng nghe trên `[::]` và sẽ không khởi động được.

## Cập nhật WordPress bị hoàn tác

Lares khôi phục bản backup khi trang chủ lỗi, xuất hiện lỗi PHP nghiêm trọng, hoặc plugin đang bật bị tắt sau khi cập nhật. Xem tab **Cập nhật → Lịch sử** để biết mục nào gây lỗi, rồi cập nhật từng mục một. Nội dung phát sinh trong lúc cập nhật (đơn hàng, bình luận) sẽ mất khi khôi phục.

## Báo lỗi

Mở issue tại https://github.com/tampham92/lares/issues, kèm phiên bản Lares (ở cuối thanh bên), hệ điều
hành (`cat /etc/os-release`), các bước bạn đã làm và những dòng log liên quan. Nhớ xoá tên miền, IP và
mật khẩu khỏi log trước khi gửi.
