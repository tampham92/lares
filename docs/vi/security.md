# Tăng cường bảo mật

[English](../en/security.md) · [Mục lục tài liệu](../README.md)

Panel chạy bằng quyền root và điều khiển mọi site trên máy, nên cần được bảo vệ kỹ như SSH. Ngay sau khi
cài, port 8686 mở cho mọi IP. Hãy làm lần lượt danh sách sau:

1. [ ] Đổi mật khẩu `admin`: **Cài đặt → Đổi mật khẩu quản trị**
2. [ ] Bật [xác thực 2 lớp](#xác-thực-2-lớp-2fa)
3. [ ] Chỉ cho các IP của bạn vào panel bằng [giới hạn IP](#giới-hạn-ip-vào-trang-quản-trị)
4. [ ] Đặt [tên miền cho trang quản trị](#tên-miền-cho-trang-quản-trị-và-chứng-chỉ-tin-cậy) để có chứng chỉ tin cậy
5. [ ] Cấu hình [firewall](#firewall) và [SSH](#ssh-cơ-bản)
6. [ ] [Cập nhật](#cập-nhật) Lares và hệ điều hành thường xuyên, và thiết lập [sao lưu](backups.md)

## Lares tự bảo vệ những gì

- Panel chỉ chạy qua HTTPS. Thông tin bí mật (mật khẩu DB/SSH, API key, biến môi trường Next.js) được
  mã hoá AES-256-GCM trong SQLite. Panel gửi kèm các security header: HSTS, chống nhúng frame,
  content-type và referrer policy.
- **Chống dò mật khẩu**: mỗi IP được thử đăng nhập tối đa 10 lần mỗi phút. Một tài khoản đăng nhập sai
  5 lần trong 15 phút thì bị khoá 15 phút. Lệnh `sudo lares reset-password [user]` mở khoá ngay.
- **Thu hồi phiên đăng nhập**: nút **Cài đặt → Đăng xuất mọi nơi** kết thúc mọi phiên. Đổi mật khẩu
  sẽ đăng xuất các phiên khác. `sudo lares reset-password` đăng xuất mọi phiên của tài khoản đó.
- Mặc định panel **không tin** header `X-Forwarded-For`. Xem phần [Reverse proxy](#đặt-panel-sau-reverse-proxy).

## Xác thực 2 lớp (2FA)

Vào **Cài đặt → Bảo mật**, quét mã QR bằng một ứng dụng TOTP bất kỳ (Google Authenticator, Aegis,
1Password, Bitwarden…), rồi nhập mã 6 số để xác nhận. Sau đó panel hiện **10 mã khôi phục**, chỉ hiện
một lần. Hãy sao chép hoặc tải chúng về và cất ở nơi khác ngoài VPS. Mỗi mã khôi phục dùng được một
lần, thay cho mã 6 số. Bạn có thể tạo bộ mã khôi phục mới bằng một mã 6 số hiện tại.

Mất cả điện thoại lẫn mã khôi phục? Tắt 2FA qua SSH:

```bash
sudo lares disable-2fa            # tài khoản admin
sudo lares disable-2fa alice      # tài khoản khác
```

## Giới hạn IP vào trang quản trị

Khi danh sách IP được phép không rỗng, chỉ các địa chỉ trong danh sách mới mở được panel. Địa chỉ có thể
là IP lẻ hoặc dải CIDR, IPv4 hoặc IPv6. Mọi IP khác bị chặn trước cả trang đăng nhập. Quản lý danh sách
trong **Cài đặt**, hoặc qua SSH:

```bash
sudo lares allowlist show
sudo lares allowlist add 203.0.113.10
sudo lares allowlist add 198.51.100.0/24
sudo lares allowlist remove 203.0.113.10
sudo lares allowlist clear        # cho mọi IP vào lại
```

- Thêm IP hiện tại của bạn **trước** khi bật danh sách. Nếu nhà mạng hay đổi IP của bạn, hãy thêm cả
  dải IP hoặc dùng SSH tunnel ở dưới.
- **Loopback (127.0.0.1 / ::1) luôn được phép**, nên SSH tunnel luôn vào được panel, kể cả khi bạn tự
  khoá mình:

  ```bash
  ssh -L 8686:127.0.0.1:8686 root@IP_VPS
  # rồi mở https://127.0.0.1:8686 trên trình duyệt
  ```

## Tên miền cho trang quản trị và chứng chỉ tin cậy

Mặc định panel dùng chứng chỉ tự ký. Gắn một tên miền thật để có chứng chỉ tin cậy:

1. Tạo bản ghi DNS, ví dụ `panel.example.com`, trỏ về IP của VPS (bản ghi A, và thêm AAAA nếu VPS có
   IPv6). Nếu dùng Cloudflare, đặt bản ghi này là **DNS only (đám mây xám)**, vì Cloudflare không
   proxy port 8686.
2. Port 80 phải truy cập được từ Internet để Let's Encrypt kiểm tra (HTTP-01).
3. Vào card **Cài đặt → Tên miền cho trang quản trị**, nhập tên miền rồi lưu. Lares xin chứng chỉ
   Let's Encrypt qua webroot của certbot (tên chứng chỉ là `lares-panel`) rồi nạp lại panel.
4. Đăng nhập lại tại `https://panel.example.com:8686`.

Chứng chỉ được gia hạn tự động: một deploy hook của certbot gửi SIGHUP tới panel
(`systemctl reload lares`), và panel nạp chứng chỉ mới mà không cần khởi động lại. Nút **Gỡ tên miền**
đưa panel về lại chứng chỉ tự ký.

## Firewall

Nếu **ufw** đang bật, installer tự mở các port 22, 80, 443 và port của panel. Nhớ kiểm tra cả firewall
(security group) của nhà cung cấp VPS.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# chỉ cho IP của bạn vào panel (thay cho "ufw allow 8686/tcp"):
sudo ufw allow from 203.0.113.10 to any port 8686 proto tcp
sudo ufw enable
sudo ufw status numbered
```

Site không có tên miền lắng nghe trên các port từ 8001. Lares tự mở các port này trên ufw, và tự đóng
lại khi bạn gán tên miền cho site.

## SSH cơ bản

- Đăng nhập bằng SSH key và tắt đăng nhập bằng mật khẩu. Trong `/etc/ssh/sshd_config`, đặt
  `PasswordAuthentication no` và `PermitRootLogin prohibit-password`, rồi chạy
  `sudo systemctl reload ssh`. **Giữ nguyên phiên SSH đang mở** và thử đăng nhập ở một phiên mới trước
  khi đóng phiên cũ.
- Tuỳ chọn: đổi port SSH (nhớ mở port mới trên ufw trước), và cài `fail2ban`.
- Bật cập nhật bảo mật tự động:
  `sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`.

## Đặt website sau Cloudflare

- **IP thật của khách** được bật sẵn, có công tắc bật/tắt ở một card trong Cài đặt. Lares ghi file
  `/etc/nginx/conf.d/lares-cloudflare.conf` chứa các dải IP của Cloudflare, nhờ đó log và thống kê
  của site hiện IP thật của khách thay vì IP của Cloudflare. Danh sách dải IP được cập nhật mỗi ngày
  từ cloudflare.com, và được hoàn tác nếu `nginx -t` báo lỗi. Nếu một panel khác trên máy đã đặt
  `real_ip_header` riêng, nginx từ chối chỉ thị trùng và card sẽ hiện lỗi. Khi đó hãy tắt công tắc,
  hoặc xoá chỉ thị kia.
- Khi site đã có chứng chỉ Let's Encrypt, chọn chế độ SSL **Full (strict)** trên Cloudflare.
- Bản thân panel thì không đặt sau proxy Cloudflare được trên port 8686 (xem ở trên).

## Đặt panel sau reverse proxy

Mặc định panel bỏ qua `X-Forwarded-For`. Nếu bạn đặt panel sau một reverse proxy trên máy, hãy đặt biến
`LARES_TRUST_PROXY` trong `/etc/lares/lares.env` rồi chạy `systemctl restart lares`:

| Giá trị | Ý nghĩa |
|---|---|
| để trống (mặc định) | Không tin header của proxy |
| `1` hoặc `true` | Tin mọi proxy |
| `127.0.0.1,10.0.0.0/8` | Chỉ tin proxy có IP/CIDR trong danh sách |

Nếu không đặt biến này, mọi request sẽ có vẻ đến từ 127.0.0.1. Khi đó giới hạn IP và giới hạn số lần
thử theo IP không còn tác dụng, vì loopback luôn được phép.

## Cập nhật

Mỗi ngày Lares kiểm tra GitHub một lần, và hiện **Có bản mới x.y.z** ở thanh bên khi có phiên bản mới.
Để nâng cấp, chạy lại `curl -sSL https://lares.thocode.dev/install | sudo bash`. Xem
[Cài đặt](installation.md#nâng-cấp).
