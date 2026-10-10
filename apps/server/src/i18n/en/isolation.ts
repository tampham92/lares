import type { Dict } from '@lares/shared';

/** Per-site isolation: own Linux user, own PHP-FPM, outbound firewall, converting older sites. */
export const ISOLATION_EN: Dict = {
  // ---- creating / deleting a site ----
  'xoá user {user}': 'delete user {user}',
  'xoá PHP-FPM của site {domain}': 'remove the PHP-FPM of {domain}',
  'Đã khởi động PHP-FPM riêng của site ({service}, user {user})': "Started the site's own PHP-FPM ({service}, user {user})",
  'Giữ lại {path} (chủ sở hữu chuyển về root)': 'Kept {path} (ownership moved to root)',
  'Cảnh báo: không xoá được user {user}: {error}': 'Warning: could not delete user {user}: {error}',
  'Đã tạo user hệ thống {user} cho site': 'Created system user {user} for the site',
  'Chưa cài PHP-FPM {version} ({bin})': 'PHP-FPM {version} is not installed ({bin})',
  'PHP-FPM từ chối cấu hình của site: {error}': "PHP-FPM rejected the site's configuration: {error}",

  // ---- outbound firewall ----
  'Cảnh báo: không cập nhật được tường lửa của site: {error}': 'Warning: could not update the site firewall: {error}',
  'Cảnh báo: máy chủ chưa có nftables (apt install nftables) nên chưa chặn được kết nối ra ngoài của các site':
    "Warning: nftables is not installed (apt install nftables), so the sites' outgoing connections are not restricted",

  // ---- converting older sites ----
  'Tính năng cách ly site đang tắt trên máy chủ này (LARES_SITE_ISOLATION=0)': 'Site isolation is turned off on this server (LARES_SITE_ISOLATION=0)',
  'đặt lại vhost {domain}': 'restore the vhost of {domain}',
  'đặt lại service {name}': 'restore service {name}',
  'trả quyền file cho {user}': 'give the files back to {user}',
  'Đang chuyển quyền sở hữu file sang {user}...': 'Giving the files to {user}...',
  'xoá bản ghi cách ly': 'clear the isolation record',
  'Site trả về HTTP {after} sau khi chuyển (trước đó {before})': 'The site answers HTTP {after} after the switch (it answered {before} before)',
  'Đã cách ly {domain}: user {user}{php}': 'Isolated {domain}: user {user}{php}',
  'LỖI khi cách ly {domain}: {error} - đang đưa site về như cũ': 'ERROR while isolating {domain}: {error} - putting the site back as it was',
  'Cách ly các site cũ ({n})': 'Isolating older sites ({n})',
  'Bỏ qua {domain}: {error}': 'Skipped {domain}: {error}',
  'Đã cách ly {ok}/{n} site': 'Isolated {ok}/{n} sites',
  'Site đã có user riêng': 'The site already has its own user',
  'Cách ly {domain}': 'Isolate {domain}',
  'Chỉ áp dụng cho site PHP đã có user riêng': 'Only for PHP sites that have their own user',

  // ---- notification center ----
  'Đã chuyển {ok} site sang user riêng': 'Moved {ok} sites to their own user',
  'Bản nâng cấp cho mỗi site một user Linux và PHP-FPM riêng: site bị nhiễm mã độc không còn đọc hay sửa được site khác.':
    'The upgrade gave every site its own Linux user and PHP-FPM: a site infected with malware can no longer read or change the other sites.',
  'Xem tài liệu': 'Read the docs',
  '{domain} chưa được cách ly': '{domain} is not isolated',
  'Lần chuyển sang user riêng thất bại, site đã được đưa về như cũ: {error}': 'Moving it to its own user failed and the site was put back as it was: {error}',
  'Mở site': 'Open site',

  // ---- resource limits (services/siteLimits.ts) ----
  'Giới hạn RAM/CPU cần site có user và tiến trình riêng (site PHP hoặc Next.js đã cách ly)':
    'RAM/CPU limits need a site with its own user and process (an isolated PHP or Next.js site)',
  'Số worker PHP chỉ áp dụng cho site PHP đã cách ly': 'PHP workers only apply to isolated PHP sites',
  'Site không có database do Lares tạo': 'The site has no database created by Lares',
  'Cảnh báo: không khôi phục được giới hạn cũ: {error}': 'Warning: could not restore the previous limits: {error}',
};
