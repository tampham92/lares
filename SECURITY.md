# Security Policy

[English](#english) · [Tiếng Việt](#tiếng-việt)

## English

Lares runs as root on production servers, so security reports get priority over everything else.

### Supported versions

Lares is in `0.x` beta. Only the latest release gets security fixes: upgrade by running the install
command again (see [README.en.md](README.en.md#does-updating-lares-lose-data)).

### Reporting a vulnerability

**Do not open a public issue or discussion.** Email **security@thocode.dev** with:

- the Lares version (bottom of the sidebar) and the OS of the VPS
- what an attacker can do, and what access they need first (anonymous visitor, logged-in admin,
  site owner, code running inside a hosted site…)
- steps to reproduce or a proof of concept

You will get a reply within 3 days. Once a fix is released, the report is credited in
[CHANGELOG.md](CHANGELOG.md) unless you prefer to stay anonymous. Please give us a reasonable time
to ship the fix before disclosing details publicly.

### Scope

In scope: the panel (`apps/`, `packages/`), `install.sh` / `uninstall.sh`, the site templates, and
the nginx/PHP/systemd configuration Lares generates. Examples: authentication or 2FA bypass, command
or path injection, a hosted site reaching the panel's secrets or another site's files beyond the
known limitation below, secrets sent back to the browser.

Not in scope:

- Known limitation: all sites run as the same `www-data` user (see
  [Current limitations](README.en.md#current-limitations)).
- The self-signed certificate warning before a panel domain is set.
- Attacks that already require root on the VPS or the panel's admin password.
- Vulnerabilities in WordPress, plugins, Node.js packages or other third-party software installed
  on the sites; report those upstream.

Hardening guide for people running Lares: [docs/en/security.md](docs/en/security.md).

## Tiếng Việt

Lares chạy bằng quyền root trên máy chủ thật, nên báo cáo bảo mật luôn được ưu tiên xử lý trước.

### Phiên bản được hỗ trợ

Lares đang ở bản beta `0.x`. Chỉ bản phát hành mới nhất được vá lỗi bảo mật: nâng cấp bằng cách
chạy lại lệnh cài đặt (xem [README.md](README.md#cập-nhật-lares-có-mất-dữ-liệu-không)).

### Báo lỗ hổng

**Đừng mở issue hay discussion công khai.** Gửi email tới **security@thocode.dev**, kèm:

- phiên bản Lares (cuối thanh bên) và hệ điều hành của VPS
- kẻ tấn công làm được gì, và cần quyền gì trước (khách vãng lai, admin đã đăng nhập, chủ site,
  code chạy bên trong một site…)
- các bước tái hiện hoặc proof of concept

Bạn sẽ nhận được phản hồi trong vòng 3 ngày. Khi bản vá được phát hành, tên bạn sẽ được ghi nhận
trong [CHANGELOG.md](CHANGELOG.md), trừ khi bạn muốn ẩn danh. Vui lòng chờ bản vá ra trước khi
công bố chi tiết.

### Phạm vi

Trong phạm vi: panel (`apps/`, `packages/`), `install.sh` / `uninstall.sh`, các template site và
cấu hình nginx/PHP/systemd do Lares tạo ra. Ví dụ: vượt qua đăng nhập hoặc 2FA, chèn lệnh hoặc
đường dẫn, một site đọc được bí mật của panel hoặc file của site khác (ngoài giới hạn đã biết bên
dưới), bí mật bị gửi về trình duyệt.

Ngoài phạm vi:

- Giới hạn đã biết: mọi site chạy chung user `www-data` (xem
  [Giới hạn hiện tại](README.md#giới-hạn-hiện-tại)).
- Cảnh báo chứng chỉ tự ký khi chưa đặt tên miền cho trang quản trị.
- Tấn công cần sẵn quyền root trên VPS hoặc mật khẩu admin của panel.
- Lỗ hổng trong WordPress, plugin, gói Node.js hay phần mềm bên thứ ba khác cài trên các site; hãy
  báo cho dự án gốc.

Hướng dẫn tăng cường bảo mật khi vận hành Lares: [docs/vi/security.md](docs/vi/security.md).
