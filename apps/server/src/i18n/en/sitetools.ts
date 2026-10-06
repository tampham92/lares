import type { Dict } from '@lares/shared';

/** Per-site PHP settings, Adminer, onboarding checklist. */
export const SITETOOLS_EN: Dict = {
  // ---- shared schemas (packages/shared/src/sitetools.ts) ----
  'Phải là một số': 'Must be a number',
  'Phải là số nguyên': 'Must be a whole number',
  'Giá trị nhỏ hơn mức cho phép': 'Value is below the allowed minimum',
  'Giá trị lớn hơn mức cho phép': 'Value is above the allowed maximum',
  'post_max_size phải lớn hơn hoặc bằng upload_max_filesize': 'post_max_size must be greater than or equal to upload_max_filesize',
  'Mặc định máy chủ': 'Server default',
  'Cơ bản': 'Basic',
  'WordPress / WooCommerce': 'WordPress / WooCommerce',
  'Lớn (import, page builder)': 'Large (imports, page builders)',

  // ---- per-site PHP settings ----
  'Chỉ áp dụng cho site PHP, WordPress và Laravel': 'Only available for PHP, WordPress and Laravel sites',
  'user_ini.filename đang để trống trong php.ini của PHP {version} nên PHP không đọc file cấu hình theo thư mục. Đặt lại user_ini.filename = .user.ini rồi thử lại.':
    'user_ini.filename is empty in the php.ini of PHP {version}, so PHP ignores per-directory ini files. Set user_ini.filename = .user.ini and try again.',
  'PHP-FPM pool của PHP {version} cố định {keys} bằng php_admin_value, site không thể đổi. Bỏ dòng đó trong pool.d rồi thử lại.':
    'The PHP-FPM pool of PHP {version} fixes {keys} with php_admin_value, so a site cannot change it. Remove that line from pool.d and try again.',
  'post_max_size ({post} MB) phải lớn hơn hoặc bằng upload_max_filesize ({upload} MB), nếu không file lớn vẫn bị từ chối.':
    'post_max_size ({post} MB) must be greater than or equal to upload_max_filesize ({upload} MB), otherwise large files are still rejected.',
  'Cảnh báo: không reload được PHP-FPM ({error}) - giá trị mới có hiệu lực sau tối đa {ttl} giây':
    'Warning: could not reload PHP-FPM ({error}) - the new values apply within {ttl} seconds',

  // ---- Adminer ----
  'Không tải được Adminer từ {url}: {error}': 'Could not download Adminer from {url}: {error}',
  'Không tải được Adminer từ {url}: HTTP {status}': 'Could not download Adminer from {url}: HTTP {status}',
  'File Adminer tải về lớn bất thường ({bytes} byte) - đã huỷ': 'The downloaded Adminer file is unusually large ({bytes} bytes) - aborted',
  'SHA-256 của Adminer tải về ({got}) khác giá trị đã ghim ({want}) - đã huỷ, không cài file này.':
    'The SHA-256 of the downloaded Adminer ({got}) differs from the pinned value ({want}) - aborted, the file was not installed.',
  'Không có phiên bản PHP-FPM nào có extension mysqli (cần cho Adminer). Cài ví dụ: apt install php{version}-mysql':
    'No PHP-FPM version has the mysqli extension (Adminer needs it). Install it, e.g.: apt install php{version}-mysql',
  'Chưa cài PHP-FPM - Adminer cần một phiên bản PHP-FPM có sẵn trên máy chủ.': 'PHP-FPM is not installed - Adminer needs a PHP-FPM version on the server.',
  'Không tìm thấy user hệ thống {user}': 'System user {user} not found',
  'PHP của Adminer thiếu extension mysqli': "Adminer's PHP lacks the mysqli extension",
  'Adminer chưa phản hồi qua nginx 127.0.0.1:{port} ({status}). Kiểm tra nginx của Lares đang chạy và PHP-FPM đã nạp pool lares-adminer.':
    'Adminer does not answer through nginx 127.0.0.1:{port} ({status}). Check that the Lares nginx is running and PHP-FPM loaded the lares-adminer pool.',
  'Hãy mở Adminer từ trang Database của Lares Panel.': 'Open Adminer from the Databases page of Lares Panel.',
  'tải {url} và kiểm tra SHA-256 {sha}': 'download {url} and check SHA-256 {sha}',
  'Cảnh báo: file Adminer hiện có không khớp SHA-256 đã ghim - tải lại': 'Warning: the installed Adminer file does not match the pinned SHA-256 - downloading it again',
  'Đang tải Adminer {version}…': 'Downloading Adminer {version}…',
  'File Adminer sau khi ghi không khớp SHA-256 - đã xoá': 'The Adminer file does not match the SHA-256 after writing - deleted',
  'PHP-FPM {version} từ chối pool của Adminer: {error}': 'PHP-FPM {version} rejected the Adminer pool: {error}',
  'Cảnh báo: {error}': 'Warning: {error}',
  'Không kết nối được Adminer': 'Cannot reach Adminer',
  'nginx/PHP-FPM của Adminer không phản hồi ({error}). Mở lại Adminer từ trang Database để Lares kiểm tra và sửa cấu hình.':
    "Adminer's nginx/PHP-FPM does not respond ({error}). Open Adminer again from the Databases page so Lares checks and repairs the setup.",
  'Adminer (chế độ dry-run)': 'Adminer (dry-run mode)',
  'Máy này chạy Lares ở chế độ dry-run (không phải Linux hoặc LARES_DRY_RUN=1) nên Adminer không chạy: cần nginx và PHP-FPM trên VPS. Đăng nhập panel, liên kết một lần và cookie đã hoạt động; trên VPS thật, trang này là Adminer đã đăng nhập sẵn.':
    'This machine runs Lares in dry-run mode (not Linux, or LARES_DRY_RUN=1), so Adminer does not run: it needs nginx and PHP-FPM on the VPS. The panel login, the one-time link and the cookie worked; on a real VPS this page is Adminer, already logged in.',
  'Database: {db} · user: {user}': 'Database: {db} · user: {user}',
  'Liên kết Adminer không hợp lệ': 'Invalid Adminer link',
  'Liên kết đã dùng, đã hết hạn (60 giây) hoặc được mở từ địa chỉ IP khác. Hãy bấm lại "Mở Adminer" trong Lares.':
    'The link was already used, expired (60 seconds) or was opened from another IP address. Click "Open Adminer" in Lares again.',
  'Adminer chỉ có tại /adminer/.': 'Adminer only lives at /adminer/.',
  'Phiên Adminer đã hết hạn': 'Adminer session expired',
  'Adminer chỉ mở được từ Lares Panel. Vào trang Database (hoặc trang site) và bấm "Mở Adminer".':
    'Adminer can only be opened from Lares Panel. Go to the Databases page (or the site page) and click "Open Adminer".',
  'Adminer chưa sẵn sàng': 'Adminer is not ready',
  'Mở Adminer từ trang Database để Lares cài đặt và kiểm tra lại.': 'Open Adminer from the Databases page so Lares installs and checks it again.',
};
