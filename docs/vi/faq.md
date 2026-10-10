# Câu hỏi thường gặp

[English](../en/faq.md) · [Mục lục tài liệu](../README.md)

**Lares có miễn phí không? Giấy phép là gì?**
Có. Lares là phần mềm tự do theo giấy phép [GNU AGPL-3.0](../../LICENSE): bạn được dùng, sửa và phân
phối lại. Nếu bạn sửa Lares rồi cho người khác dùng qua mạng (ví dụ làm dịch vụ hosting), bạn phải
cung cấp mã nguồn bản đã sửa cho họ.

**Hỗ trợ hệ điều hành nào?**
Ubuntu 22.04 / 24.04 và Debian 12 (x86_64, arm64). Debian 13 cài được, kèm cảnh báo "chưa kiểm thử".
Ubuntu 20.04 và Debian 11 đã hết vòng đời nên bị từ chối, trừ khi bạn thêm `--force-unsupported`. Xem
[Cài đặt](installation.md#hệ-điều-hành-được-hỗ-trợ).

**Cài lên VPS đang có site hoặc panel khác được không?**
Được. Lares dùng lại nginx, MySQL/MariaDB và PHP-FPM đang có, không cài đè. Nếu port 80/443 đang do một
web server khác giữ, nginx của Lares sẽ dừng (chế độ cùng tồn tại) cho tới khi bạn chuyển hẳn sang. Sau
đó dùng **Chuyển site** để đưa các site về Lares.

**Nâng cấp có làm gián đoạn website không?**
Không. Chỉ panel gián đoạn vài giây, website vẫn chạy bình thường. Để nâng cấp, chạy lại lệnh cài đặt,
xem [Nâng cấp](installation.md#nâng-cấp).

**Làm sao biết có bản mới?**
Thanh bên hiện **Có bản mới x.y.z** kèm lệnh nâng cấp. Phiên bản đang chạy hiện ở cuối thanh bên.

**Lares gửi gì về máy chủ của ThoCode?**
Chỉ một bộ đếm ẩn danh: mã cài đặt ngẫu nhiên, phiên bản Lares, sự kiện (install/upgrade/heartbeat), tên
và phiên bản hệ điều hành, kiến trúc CPU, ngôn ngữ panel. Không gửi IP, tên miền hay dữ liệu site. Tắt
bằng `--no-telemetry` hoặc `LARES_TELEMETRY=0`, xem
[Thống kê ẩn danh](installation.md#thống-kê-ẩn-danh-telemetry). Việc kiểm tra bản mới mỗi ngày chỉ đọc
danh sách tag phát hành trên GitHub. Muốn tắt, vào **Cài đặt → Cập nhật**, hoặc đặt `LARES_UPDATE_CHECK=0`.

**Đổi port của panel thế nào?**
Chạy `curl -sSL https://lares.thocode.dev/install | sudo bash -s -- --port 9443`. Đây là một lần nâng
cấp nên mọi thứ khác được giữ nguyên. Nhớ mở port mới trên firewall.

**Quên mật khẩu, mất điện thoại 2FA, hoặc tự khoá mình bằng giới hạn IP?**
Chạy qua SSH: `sudo lares reset-password`, `sudo lares disable-2fa`, `sudo lares allowlist clear`. SSH
tunnel (`ssh -L 8686:127.0.0.1:8686 root@VPS`) luôn vào được panel, dù đang bật giới hạn IP.

**Đặt panel sau Cloudflare được không?**
Không, nếu panel ở port 8686: Cloudflare không proxy port này, nên bản ghi tên miền của panel phải là
DNS only. Còn **website** thì đặt sau Cloudflare thoải mái, và Lares khôi phục IP thật của khách trong
log của site.

**Lares có email, DNS hosting, Docker hay tài khoản đại lý (reseller) không?**
Hiện chưa có. Lares tập trung vào website (WordPress, Next.js, PHP, HTML tĩnh), SSL, database, log, sao
lưu và chuyển site.

**Dữ liệu của tôi nằm ở đâu?**
Site ở `/var/www/<domain>`, dữ liệu panel ở `/var/lib/lares`, cấu hình và khoá giải mã ở
`/etc/lares/lares.env`, log ở `/var/log/lares`, bản sao lưu ở `/var/backups/lares`.

**Gỡ Lares có mất site không?**
Mặc định thì không: `uninstall.sh` chỉ gỡ panel, các site vẫn chạy. Còn `--purge` xoá mọi thứ Lares đã
tạo, trừ bản sao lưu.
