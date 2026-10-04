# Sao lưu

[English](../en/backups.md) · [Mục lục tài liệu](../README.md)

Lares có hai loại bản sao lưu.

## Sao lưu site

Mỗi site có một tab **Sao lưu**. Một bản sao lưu gồm file của site và các database MySQL/MariaDB của
site, và được lưu **ngay trên VPS**:

```
/var/backups/lares/<domain>/<YYYYMMDD-HHMMSS>/
    files.tar.gz          thư mục site
    db-<tên>.sql.gz       mỗi database một file dump
    manifest.json         nội dung đã sao lưu, thời điểm, dung lượng
```

- **Sao lưu ngay**: tạo một bản sao lưu thủ công, ví dụ trước khi cập nhật plugin. Bản thủ công không
  bao giờ bị tự động xoá.
- **Lịch hằng ngày**: vào **Cài đặt → Sao lưu**, chọn giờ chạy (HH:MM, theo giờ của VPS) và số bản sao
  lưu theo lịch giữ lại cho mỗi site (mặc định 7). Có thể tắt sao lưu theo lịch cho từng site. Chỉ các
  bản theo lịch mới bị tự động xoá bớt.
- **Tải về**: panel tạo một link có chữ ký, hiệu lực 5 phút. File tải về là một file `.tar` chứa các
  phần đã nén gzip ở trên.
- **Khôi phục**: chọn một bản sao lưu rồi gõ tên miền của site để xác nhận. Trước tiên Lares tự sao lưu
  trạng thái hiện tại (bản an toàn), sau đó mới thay file và database. Nếu khôi phục lỗi, Lares tự
  rollback về trạng thái trước đó.
- **Xoá site thì bản sao lưu vẫn còn.** Muốn khôi phục, tạo lại một site cùng tên miền.
- **Thư mục sao lưu**: mặc định là `/var/backups/lares` (quyền 0700, chỉ root đọc được). Có thể đổi
  trong Cài đặt, hoặc bằng biến `LARES_BACKUP_DIR` trong `/etc/lares/lares.env`. Sau khi đổi, các bản
  cũ không còn hiện trong panel nhưng vẫn nằm trong thư mục cũ.
- `uninstall.sh`, kể cả với `--purge`, không bao giờ xoá thư mục sao lưu. Cuối quá trình gỡ, nó in ra
  đường dẫn để bạn tự xoá nếu muốn.

Hiện bản sao lưu **chỉ lưu trên VPS**. Lưu trữ từ xa sẽ có sau, trong lúc chờ bạn hãy tự chép ra ngoài
như hướng dẫn dưới đây.

### Giữ một bản ở ngoài VPS

Bản sao lưu nằm cùng ổ đĩa sẽ mất theo khi hỏng ổ, xoá nhầm VPS hoặc VPS bị xâm nhập. Hãy chép
`/var/backups/lares` ra nơi khác thường xuyên, ví dụ dùng rsync sang một máy khác:

```bash
# chạy hằng ngày bằng cron trên máy lưu trữ
rsync -a root@IP_VPS:/var/backups/lares/ /srv/lares-backups/IP_VPS/
```

Bạn cũng có thể dùng `rclone sync /var/backups/lares remote:lares-backups` để đẩy lên S3, Backblaze B2,
Google Drive… Bản sao lưu có chứa database, nên hãy lưu ở nơi riêng tư hoặc mã hoá.

Nhớ theo dõi dung lượng trống (`df -h /var/backups`), vì bản sao lưu của site lớn chiếm chỗ rất nhanh.

## Dữ liệu của chính Lares

Mỗi lần nâng cấp (chạy lại installer), trước tiên Lares lưu trạng thái của chính nó vào
`/var/lib/lares/backups/lares-YYYYMMDD-HHMMSS.tar.gz`, và giữ 5 bản mới nhất. File này gồm:

- `/etc/lares/`: `lares.env` (chứa **`LARES_SECRET`**), chứng chỉ của panel, script khởi động Next.js,
  chứng chỉ riêng của các site
- `/var/lib/lares/lares.db*`: danh sách site, cài đặt, mật khẩu đã mã hoá, lịch sử chuyển site
- `/var/lib/lares/templates/`: template riêng của bạn

Khôi phục khi nâng cấp gặp sự cố:

```bash
sudo systemctl stop lares
sudo tar -xzf /var/lib/lares/backups/lares-YYYYMMDD-HHMMSS.tar.gz -C /
sudo systemctl start lares
```

**Hãy giữ một bản `/etc/lares/lares.env` ở ngoài VPS.** Mất `LARES_SECRET` thì các mật khẩu DB, SSH và
API key đã lưu không giải mã được nữa. Installer cũng từ chối dùng lại dữ liệu cũ nếu thiếu file env.

## Chuyển sang VPS mới

Cách đơn giản nhất: cài Lares trên VPS mới, rồi dùng **Chuyển site** với VPS cũ làm máy nguồn. Lares
chép file và database, đồng thời sửa lại cấu hình. Sau đó đổi DNS sang VPS mới và cài SSL trên đó.
