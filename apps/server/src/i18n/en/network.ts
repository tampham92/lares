import type { Dict } from '@lares/shared';

/** English for src/services/cloudflare.ts, src/services/panelTls.ts and src/routes/network.ts */
export const NETWORK_EN: Dict = {
  // Cloudflare real IP
  'Danh sách IP Cloudflare có dòng không hợp lệ: {line}': 'The Cloudflare IP list contains an invalid line: {line}',
  'Danh sách IP Cloudflare có số dòng bất thường ({n})': 'The Cloudflare IP list has an unexpected number of lines ({n})',
  'Không tải được {url} (HTTP {status})': 'Could not download {url} (HTTP {status})',
  'Hết thời gian chờ khi tải danh sách IP Cloudflare': 'Timed out downloading the Cloudflare IP list',
  'Đã cập nhật danh sách IP Cloudflare cho nginx ({n} dải)': 'Updated the Cloudflare IP list for nginx ({n} ranges)',
  'Đã tắt khôi phục IP thật sau Cloudflare': 'Real visitor IP behind Cloudflare is now disabled',
  'Không cập nhật được danh sách IP Cloudflare: {error}': 'Could not update the Cloudflare IP list: {error}',
  'Không áp dụng được cấu hình IP Cloudflare: {error}': 'Could not apply the Cloudflare IP configuration: {error}',

  // Panel domain + certificate
  'Đã nạp lại chứng chỉ HTTPS của trang quản trị': "Reloaded the panel's HTTPS certificate",
  'Không nạp lại được chứng chỉ HTTPS của trang quản trị: {error}': "Could not reload the panel's HTTPS certificate: {error}",
  'Trang quản trị sẽ khởi động lại sau vài giây để dùng chứng chỉ mới': 'The panel will restart in a few seconds to use the new certificate',
  'Không tìm thấy file cấu hình {path}': 'Configuration file {path} not found',
  'trang quản trị sẽ dùng chứng chỉ {path}': 'the panel would use certificate {path}',
  'Đã áp dụng chứng chỉ mới cho trang quản trị (không cần khởi động lại)': 'The panel now uses the new certificate (no restart needed)',
  'Đang có thao tác khác với tên miền trang quản trị, hãy chờ hoàn tất': 'Another panel domain operation is in progress, please wait for it to finish',
  'Kiểm tra DNS của {domain}…': 'Checking DNS for {domain}…',
  'Tên miền chưa trỏ về máy chủ này: {details}. Trỏ bản ghi DNS A về IP máy chủ (nếu dùng Cloudflare: tắt proxy - đám mây xám) rồi thử lại.':
    'The domain does not point to this server: {details}. Point a DNS A record to the server IP (with Cloudflare: turn the proxy off - grey cloud), then try again.',
  'Ghi cấu hình nginx {path}': 'Writing nginx configuration {path}',
  "Xin chứng chỉ Let's Encrypt cho {domain}…": "Requesting a Let's Encrypt certificate for {domain}…",
  'Chứng chỉ nhận được không chứa {domain}': 'The issued certificate does not cover {domain}',
  "Không lấy được chứng chỉ Let's Encrypt cho {domain}: {error}": "Could not obtain a Let's Encrypt certificate for {domain}: {error}",
  'Chứng chỉ mới không dùng được, trang quản trị giữ chứng chỉ cũ: {error}': 'The new certificate cannot be used, the panel keeps its previous certificate: {error}',
  'Xong. Trang quản trị: {url}': 'Done. Panel address: {url}',
  'Tạo lại chứng chỉ tự ký {path}': 'Regenerating the self-signed certificate {path}',
  'Không gỡ được cấu hình nginx của tên miền trang quản trị: {error}': "Could not remove the panel domain's nginx configuration: {error}",
  'Tên miền trang quản trị {domain}': 'Panel domain {domain}',
};
