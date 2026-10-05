import type { Dict } from '@lares/shared';

/** English for strings in components/CloudflareDnsCard.tsx, CloudflareDnsOption.tsx and SiteDnsCard.tsx */
export const DNS_EN: Dict = {
  // Settings card: token
  'Kết nối tài khoản Cloudflare để Lares tự tạo bản ghi DNS khi thêm site hoặc gán tên miền, và bật/tắt proxy ngay trong trang site.':
    'Connect your Cloudflare account so Lares creates DNS records when you add a site or assign a domain, and switches the proxy on/off from the site page.',
  'Lần kiểm tra gần nhất lỗi: {error}': 'The last check failed: {error}',
  'Đã kết nối': 'Connected',
  'Tài khoản': 'Account',
  'Xác minh lúc': 'Verified at',
  'Zone ({n})': 'Zones ({n})',
  'Ngắt kết nối Cloudflare? Bản ghi DNS đã tạo vẫn giữ nguyên.': 'Disconnect Cloudflare? DNS records already created stay as they are.',
  'Đã ngắt kết nối Cloudflare': 'Cloudflare disconnected',
  'Ngắt kết nối': 'Disconnect',
  'Token hợp lệ, đã cập nhật danh sách zone': 'The token is valid, zone list updated',
  'Kiểm tra lại': 'Check again',
  'Tạo token tại': 'Create a token at',
  '(mẫu "Edit zone DNS"). Quyền cần có:': '("Edit zone DNS" template). Required permissions:',
  'và': 'and',
  '; mục Zone Resources chọn các zone sẽ dùng (hoặc All zones). Token được mã hoá trên máy chủ và không bao giờ gửi lại trình duyệt.':
    '; under Zone Resources pick the zones to use (or All zones). The token is encrypted on the server and never sent back to the browser.',
  'Dán API token': 'Paste the API token',
  'Đã kết nối Cloudflare': 'Cloudflare connected',
  'Kiểm tra & kết nối': 'Verify & connect',

  // Settings card: server IP
  'IP public của máy chủ': 'Server public IP',
  'Nội dung của bản ghi A/AAAA. Lares tự phát hiện; chỉ nhập khi máy chủ có nhiều IP hoặc đứng sau NAT/firewall riêng.':
    'Content of the A/AAAA records. Lares detects it; only enter it when the server has several IPs or sits behind NAT or its own firewall.',
  'Đang dùng': 'In use',
  'chưa có IPv4': 'no IPv4 yet',
  'Tự phát hiện': 'Detected',
  'Đang phát hiện IP…': 'Detecting IP…',
  'IPv4 (tuỳ chọn)': 'IPv4 (optional)',
  'IPv6 (tuỳ chọn)': 'IPv6 (optional)',
  'Không tạo bản ghi AAAA (IPv6 của máy chủ không truy cập được từ ngoài)': "Don't create AAAA records (the server's IPv6 is not reachable from outside)",
  'Đã phát hiện lại IP': 'IP detected again',
  'Phát hiện lại': 'Detect again',
  'Đã lưu IP máy chủ': 'Server IP saved',
  'Lưu IP': 'Save IP',

  // Panel domain record
  'Ghi đè bản ghi của {hostname} ({records}) để trỏ về máy chủ này?': 'Overwrite the record of {hostname} ({records}) to point to this server?',
  'Cloudflare (zone {zone}):': 'Cloudflare (zone {zone}):',
  'bản ghi đã đúng, DNS only': 'record is correct, DNS only',
  'đang bật proxy - cần DNS only': 'proxied - must be DNS only',
  'chưa có bản ghi': 'no record yet',
  'cần cập nhật': 'needs an update',
  'đang trỏ nơi khác': 'points elsewhere',
  'Tạo bản ghi DNS (DNS only)': 'Create DNS record (DNS only)',
  'Ghi đè (DNS only)': 'Overwrite (DNS only)',

  // Add site / assign domain option
  'đã đúng': 'correct',
  'sẽ tạo mới': 'will be created',
  'sẽ cập nhật': 'will be updated',
  'ngoài Cloudflare': 'not on Cloudflare',
  'Mẹo: kết nối Cloudflare trong': 'Tip: connect Cloudflare in',
  'để Lares tự tạo bản ghi DNS cho tên miền.': 'so Lares creates the DNS records for your domains.',
  'Đang kiểm tra DNS trên Cloudflare…': 'Checking DNS on Cloudflare…',
  '{domain} không thuộc zone nào của tài khoản Cloudflare đã kết nối - hãy tự tạo bản ghi DNS.':
    '{domain} is not in any zone of the connected Cloudflare account - create the DNS records yourself.',
  'Tự tạo bản ghi DNS trên Cloudflare': 'Create DNS records on Cloudflare',
  "Bản ghi A/AAAA trỏ về {ip}, chế độ DNS only (đám mây xám) để cấp SSL Let's Encrypt được ngay. Có thể bật proxy sau khi cài SSL.":
    "A/AAAA records pointing to {ip}, DNS only (grey cloud) so Let's Encrypt SSL can be issued right away. You can turn the proxy on after installing SSL.",
  'Chưa xác định được IP public của máy chủ - nhập IP trong Cài đặt → Cloudflare DNS.': "The server's public IP is unknown - enter it in Settings → Cloudflare DNS.",
  'Đang có bản ghi {records}. Lares không đổi bản ghi này nếu bạn không chọn ghi đè.': 'There is already a record {records}. Lares leaves it alone unless you choose to overwrite it.',
  'Ghi đè, trỏ {hostname} về máy chủ này': 'Overwrite, point {hostname} to this server',

  // Site page DNS card
  'Tên miền đang trỏ về đâu (tra cứu DNS công khai qua 1.1.1.1 và 8.8.8.8) và bản ghi tương ứng trên Cloudflare.':
    'Where each hostname resolves (public DNS lookup via 1.1.1.1 and 8.8.8.8) and its record on Cloudflare.',
  'Đang kiểm tra DNS…': 'Checking DNS…',
  'IP máy chủ': 'Server IP',
  'chưa xác định -': 'unknown -',
  'nhập trong Cài đặt': 'enter it in Settings',
  'Kết nối Cloudflare trong': 'Connect Cloudflare in',
  'để tạo bản ghi và bật/tắt proxy ngay tại đây.': 'to create records and switch the proxy right here.',
  'Đang trỏ về': 'Resolves to',
  "Bản ghi mới được tạo ở chế độ DNS only (đám mây xám) để Let's Encrypt xác thực được ngay. Sau khi cài SSL có thể bật proxy; khi đó đặt SSL/TLS của Cloudflare ở chế độ Full (strict).":
    "New records are DNS only (grey cloud) so Let's Encrypt can validate right away. After installing SSL you can turn the proxy on; then set Cloudflare's SSL/TLS mode to Full (strict).",
  'Cài SSL trước': 'Install SSL first',
  'Bật proxy Cloudflare': 'Turn on Cloudflare proxy',
  'Bật proxy Cloudflare sau khi cài SSL': 'Turn on Cloudflare proxy after installing SSL',
  'Đúng máy chủ': 'This server',
  'Qua proxy Cloudflare': 'Via Cloudflare proxy',
  'Không tra cứu được': 'Lookup failed',
  'Chưa có bản ghi': 'No record',
  'Trỏ nơi khác': 'Points elsewhere',
  'ngoài các zone đã kết nối': 'not in the connected zones',
  'Proxy (đám mây cam)': 'Proxied (orange cloud)',
  'DNS only (đám mây xám)': 'DNS only (grey cloud)',
  'Cần cập nhật': 'Needs update',
  'Chờ DNS cập nhật': 'Waiting for DNS',
  'Zone {zone} đang ở trạng thái "{status}": nameserver của tên miền chưa trỏ về Cloudflare.': 'Zone {zone} is "{status}": the domain\'s nameservers do not point to Cloudflare yet.',
  'Thiếu bản ghi {types}': 'Missing {types} record',
  'Tạo/sửa bản ghi': 'Create/fix records',
  'Ghi đè': 'Overwrite',
  'Bật proxy': 'Proxy on',
  'Tắt proxy': 'Proxy off',
};
