import type { Dict } from '@lares/shared';

/** English for strings in components/NetworkSettings.tsx */
export const NETWORK_EN: Dict = {
  // Panel domain
  'Tên miền cho trang quản trị': 'Panel domain',
  "Mặc định trang quản trị dùng chứng chỉ tự ký nên trình duyệt hiện cảnh báo. Gắn một tên miền trỏ về máy chủ này để Lares xin chứng chỉ Let's Encrypt miễn phí (tự gia hạn).":
    "By default the panel uses a self-signed certificate, so browsers show a warning. Attach a domain that points to this server and Lares will get a free Let's Encrypt certificate (renewed automatically).",
  'Chứng chỉ': 'Certificate',
  'hợp lệ': 'trusted',
  'Tự ký': 'Self-signed',
  'trình duyệt sẽ cảnh báo': 'browsers will warn',
  'Chưa bật HTTPS': 'HTTPS is not enabled',
  'Chứng chỉ đã sẵn sàng. Mở trang quản trị tại': 'The certificate is ready. Open the panel at',
  '(cần đăng nhập lại ở địa chỉ mới)': '(you will need to log in again at the new address)',
  'Bản ghi DNS A phải trỏ thẳng về IP máy chủ. Nếu dùng Cloudflare, tắt proxy (đám mây xám) cho tên miền này vì Cloudflare không chuyển tiếp port {port}.':
    'The DNS A record must point directly to the server IP. With Cloudflare, turn the proxy off (grey cloud) for this hostname, because Cloudflare does not forward port {port}.',
  "Email nhận thông báo từ Let's Encrypt (tuỳ chọn)": "Email for Let's Encrypt notices (optional)",
  'Bỏ qua kiểm tra DNS': 'Skip the DNS check',
  'Gỡ tên miền và quay về chứng chỉ tự ký?': 'Remove the domain and go back to the self-signed certificate?',
  'Gỡ tên miền (về chứng chỉ tự ký)': 'Remove domain (back to self-signed)',
  'Kiểm tra DNS': 'Check DNS',
  '{domain} đã trỏ về máy chủ này': '{domain} points to this server',
  'Cài chứng chỉ': 'Get certificate',

  // Cloudflare real IP
  'IP thật của khách truy cập (Cloudflare)': 'Real visitor IP (Cloudflare)',
  'Khi site bật proxy Cloudflare (đám mây cam), nginx chỉ thấy IP của Cloudflare. Bật mục này để log truy cập và thống kê lưu IP thật (header CF-Connecting-IP, chỉ tin khi request đến từ dải IP của Cloudflare).':
    "When a site is proxied by Cloudflare (orange cloud), nginx only sees Cloudflare's IPs. Enable this so access logs and statistics record the real visitor IP (CF-Connecting-IP header, trusted only for requests coming from Cloudflare's IP ranges).",
  'Lần cập nhật gần nhất lỗi: {error}': 'The last update failed: {error}',
  'Đã bật': 'Enabled',
  'Đã tắt': 'Disabled',
  'Khôi phục IP thật sau Cloudflare': 'Restore the real IP behind Cloudflare',
  'Dải IP': 'IP ranges',
  '{v4} IPv4, {v6} IPv6': '{v4} IPv4, {v6} IPv6',
  'Cập nhật từ cloudflare.com': 'Updated from cloudflare.com',
  'chưa - đang dùng danh sách có sẵn': 'not yet - using the bundled list',
  'File cấu hình': 'Config file',
  'Đã cập nhật danh sách IP Cloudflare': 'Cloudflare IP list updated',
  'Cập nhật ngay': 'Update now',
};
