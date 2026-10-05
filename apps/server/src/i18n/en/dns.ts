import type { Dict } from '@lares/shared';

/** English for src/services/cloudflareDns.ts, src/services/publicIp.ts, src/routes/dns.ts and the schemas in @lares/shared dns.ts */
export const DNS_EN: Dict = {
  // Schemas
  'API token không hợp lệ': 'Invalid API token',
  'Địa chỉ IPv4 không hợp lệ': 'Invalid IPv4 address',
  'Địa chỉ IPv6 không hợp lệ': 'Invalid IPv6 address',

  // Token, API errors
  'Cloudflare từ chối API token: {detail}. Kiểm tra lại token (còn hiệu lực, dán đủ ký tự).':
    'Cloudflare rejected the API token: {detail}. Check the token (still valid, pasted in full).',
  'API token không đủ quyền ({detail}). Token cần quyền Zone → DNS → Edit và Zone → Zone → Read cho zone này.':
    'The API token lacks permissions ({detail}). It needs Zone → DNS → Edit and Zone → Zone → Read for this zone.',
  'Cloudflare đang giới hạn số lượng yêu cầu, thử lại sau ít phút': 'Cloudflare is rate limiting requests, try again in a few minutes',
  'Cloudflare báo lỗi {status}: {detail}': 'Cloudflare returned an error {status}: {detail}',
  'Hết thời gian chờ khi gọi API Cloudflare': 'Timed out calling the Cloudflare API',
  'Không kết nối được API Cloudflare: {error}': 'Could not reach the Cloudflare API: {error}',
  'ID zone Cloudflare không hợp lệ': 'Invalid Cloudflare zone ID',
  'API token đang ở trạng thái "{status}" (cần "active")': 'The API token is "{status}" (it must be "active")',
  'Token hợp lệ nhưng không truy cập được zone nào. Khi tạo token, ở mục Zone Resources hãy chọn zone cần dùng (hoặc All zones).':
    'The token is valid but cannot access any zone. When creating the token, pick the zones to use under Zone Resources (or All zones).',
  'Token không đọc được bản ghi DNS của zone {zone}: {error}': 'The token cannot read the DNS records of zone {zone}: {error}',
  'Chưa kết nối Cloudflare - thêm API token trong Cài đặt → Cloudflare DNS': 'Cloudflare is not connected - add an API token in Settings → Cloudflare DNS',
  'Chưa xác định được IP public của máy chủ - nhập IP trong Cài đặt → Cloudflare DNS':
    "The server's public IP is unknown - enter it in Settings → Cloudflare DNS",

  // Records
  'Cảnh báo: {message}': 'Warning: {message}',
  'Cloudflare DNS: {hostname} đang có {current} - không thay đổi. Chọn "Ghi đè" nếu muốn trỏ về máy chủ này.':
    'Cloudflare DNS: {hostname} has {current} - left unchanged. Choose "Overwrite" to point it to this server.',
  'Cloudflare DNS: đã tắt proxy (DNS only) cho {record}': 'Cloudflare DNS: proxy turned off (DNS only) for {record}',
  'Cloudflare DNS: {record} đã trỏ về {ip}, giữ nguyên': 'Cloudflare DNS: {record} already points to {ip}, unchanged',
  'Cloudflare DNS: đã tạo {record} → {ip} (DNS only)': 'Cloudflare DNS: created {record} → {ip} (DNS only)',
  'Cloudflare DNS: đã xoá {type} {name} → {content}': 'Cloudflare DNS: deleted {type} {name} → {content}',
  'Cloudflare DNS: đã cập nhật {record}: {old} → {ip}': 'Cloudflare DNS: updated {record}: {old} → {ip}',
  'Cloudflare DNS: {hostname} không thuộc zone nào của tài khoản Cloudflare đã kết nối - bỏ qua':
    'Cloudflare DNS: {hostname} is not in any zone of the connected Cloudflare account - skipped',
  'Cloudflare DNS: lỗi với {hostname}: {error}': 'Cloudflare DNS: error for {hostname}: {error}',
  'Cloudflare DNS: {hostname} chưa có bản ghi trỏ về máy chủ này - bấm "Tạo/sửa bản ghi" trước':
    'Cloudflare DNS: {hostname} has no record pointing to this server - click "Create/fix records" first',
  'Cloudflare DNS: đã bật proxy cho {record}': 'Cloudflare DNS: proxy turned on for {record}',
  'Cloudflare DNS: {record} đã bật proxy từ trước': 'Cloudflare DNS: {record} was already proxied',
  'Cloudflare DNS: {record} đã ở chế độ DNS only': 'Cloudflare DNS: {record} is already DNS only',
  'Chế độ SSL/TLS của zone {zone} đang là "{mode}". Hãy đổi sang Full (strict) trong Cloudflare, nếu không site có thể bị lặp chuyển hướng.':
    'The SSL/TLS mode of zone {zone} is "{mode}". Switch it to Full (strict) in Cloudflare, otherwise the site may end up in a redirect loop.',
  'Nhớ đặt chế độ SSL/TLS của zone {zone} là Full (strict) trong Cloudflare.': 'Remember to set the SSL/TLS mode of zone {zone} to Full (strict) in Cloudflare.',
  'Chưa kết nối Cloudflare - bỏ qua tạo bản ghi DNS': 'Cloudflare is not connected - skipping DNS records',
  'Tạo bản ghi DNS trên Cloudflare (DNS only - đám mây xám)…': 'Creating DNS records on Cloudflare (DNS only - grey cloud)…',
  'Không tạo được bản ghi DNS trên Cloudflare: {error}': 'Could not create DNS records on Cloudflare: {error}',

  // Public IP
  '{ip} là địa chỉ nội bộ, không dùng được cho bản ghi DNS công khai': '{ip} is a private address and cannot be used in public DNS records',

  // Routes
  'Site đang chạy theo port (chưa có tên miền) nên không có bản ghi DNS': 'The site is served on a port (no domain yet), so it has no DNS records',
  '{hostname} không thuộc site này': '{hostname} does not belong to this site',
  'Cài SSL cho site trước khi bật proxy Cloudflare': 'Install SSL on the site before turning on the Cloudflare proxy',
};
