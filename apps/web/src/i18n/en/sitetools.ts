import type { Dict } from '@lares/shared';

/** English for components/PhpSettingsTab.tsx, components/AdminerButton.tsx, components/OnboardingCard.tsx, @lares/shared sitetools.ts */
export const SITETOOLS_EN: Dict = {
  // ---- shared schemas ----
  'Phải là một số': 'Must be a number',
  'Phải là số nguyên': 'Must be a whole number',
  'Giá trị nhỏ hơn mức cho phép': 'Value is below the allowed minimum',
  'Giá trị lớn hơn mức cho phép': 'Value is above the allowed maximum',
  'post_max_size phải lớn hơn hoặc bằng upload_max_filesize': 'post_max_size must be greater than or equal to upload_max_filesize',
  'Mặc định máy chủ': 'Server default',
  'Cơ bản': 'Basic',
  'WordPress / WooCommerce': 'WordPress / WooCommerce',
  'Lớn (import, page builder)': 'Large (imports, page builders)',

  // ---- PHP settings tab ----
  'Dung lượng file upload tối đa': 'Max upload file size',
  'Dung lượng request POST tối đa': 'Max POST request size',
  'Giới hạn bộ nhớ': 'Memory limit',
  'Thời gian chạy tối đa': 'Max execution time',
  'Số biến input tối đa': 'Max input variables',
  'Site (Lares)': 'Site (Lares)',
  '.user.ini (dòng khác)': '.user.ini (other line)',
  'PHP-FPM pool': 'PHP-FPM pool',
  'PHP mặc định': 'PHP default',
  'giây': 'seconds',
  'Số nguyên từ {min} đến {max}': 'Whole number from {min} to {max}',
  'Phải ≥ upload_max_filesize ({n} MB)': 'Must be ≥ upload_max_filesize ({n} MB)',
  'Đã lưu: .user.ini được cập nhật, nginx cho phép request tới {n} MB, PHP-FPM đã reload.': 'Saved: .user.ini updated, nginx accepts requests up to {n} MB, PHP-FPM reloaded.',
  'Giới hạn PHP của site': 'PHP limits for this site',
  'Để trống = dùng giá trị của máy chủ. Áp dụng riêng cho site này qua file .user.ini trong web root; nginx tự nâng giới hạn upload theo.':
    "Empty = use the server's value. Applies to this site only, through a .user.ini file in the web root; nginx follows the upload limit automatically.",
  'PHP {version} đang tắt .user.ini (user_ini.filename trống trong php.ini), không áp dụng được giá trị riêng cho site.':
    'PHP {version} has .user.ini turned off (user_ini.filename is empty in php.ini), so per-site values cannot apply.',
  'Mẫu có sẵn:': 'Presets:',
  'máy chủ: {value}': 'server: {value}',
  'Bỏ mọi giá trị riêng của site và dùng lại giá trị máy chủ?': "Drop all of this site's own values and use the server's values again?",
  'Dùng giá trị máy chủ': 'Use server values',
  'Đang lưu…': 'Saving…',
  'Giá trị đang áp dụng': 'Values in effect',
  'Thiết lập': 'Set up',
  'Máy chủ': 'Server',
  'Hiệu lực': 'Effective',
  'khoá bởi pool': 'locked by pool',
  'File cấu hình': 'Config file',
  'PHP-FPM pool cố định {keys} bằng php_admin_value nên site không đổi được.': 'The PHP-FPM pool fixes {keys} with php_admin_value, so the site cannot change it.',
  'File .user.ini còn có dòng khác (không do Lares ghi) đặt {keys}; dòng nằm sau cùng trong file sẽ có hiệu lực.':
    '.user.ini has other lines (not written by Lares) setting {keys}; the last line in the file wins.',
  'Chỉ áp dụng cho PHP chạy qua web (PHP-FPM). wp-cli và cron dùng PHP CLI nên không đọc .user.ini.':
    'Only applies to PHP served over the web (PHP-FPM). wp-cli and cron use the PHP CLI, which ignores .user.ini.',

  // ---- Adminer ----
  'Mở Adminer đã đăng nhập sẵn vào database này (tab mới)': 'Open Adminer logged in to this database (new tab)',
  'Mở Adminer ↗': 'Open Adminer ↗',
  'Gỡ Adminer khỏi máy chủ? (xoá file, pool PHP-FPM và cấu hình nginx; database không bị ảnh hưởng)':
    'Remove Adminer from the server? (deletes its files, PHP-FPM pool and nginx config; databases are not affected)',
  'Chế độ dry-run: "Mở Adminer" chạy thử đăng nhập một lần và cookie, nhưng Adminer chỉ thực sự chạy trên VPS Linux có PHP-FPM và nginx.':
    'Dry-run mode: "Open Adminer" exercises the one-time login and the cookie, but Adminer itself only runs on a Linux VPS with PHP-FPM and nginx.',
  'Adminer {version} · PHP {php} · chỉ truy cập qua Lares (đăng nhập panel + giới hạn IP), không mở trên site công khai.':
    'Adminer {version} · PHP {php} · only reachable through Lares (panel login + IP allowlist), never on a public site.',
  'Lần đầu mở, Lares tải Adminer {version} (kiểm tra SHA-256), tạo pool PHP-FPM riêng và nginx chỉ nghe 127.0.0.1.':
    'On first use Lares downloads Adminer {version} (SHA-256 checked) and sets up a dedicated PHP-FPM pool and an nginx server listening on 127.0.0.1 only.',
  'Gỡ Adminer': 'Remove Adminer',

  // ---- Onboarding ----
  'Chỉ IP của bạn mới mở được trang đăng nhập. Cài đặt → Giới hạn IP truy cập panel.': 'Only your IPs can reach the login page. Settings → Panel IP allowlist.',
  'Bật xác thực hai lớp (2FA)': 'Turn on two-factor authentication (2FA)',
  'Lộ mật khẩu cũng không đủ để vào panel. Cài đặt → Xác thực hai lớp (2FA).': 'A leaked password alone is not enough to get in. Settings → Two-factor authentication (2FA).',
  'Bật 2FA': 'Enable 2FA',
  'Gắn tên miền và HTTPS cho trang quản trị': 'Give the panel a domain and HTTPS',
  "Chứng chỉ Let's Encrypt thay cho chứng chỉ tự ký. Cài đặt → Tên miền cho trang quản trị.": "A Let's Encrypt certificate instead of the self-signed one. Settings → Panel domain.",
  'Tạo website đầu tiên': 'Create your first website',
  'WordPress, Next.js, PHP hoặc HTML tĩnh - hoặc chuyển site từ máy chủ khác về.': 'WordPress, Next.js, PHP or static HTML - or migrate a site from another server.',
  'Thêm site': 'Add site',
  'Bật sao lưu tự động hằng ngày': 'Turn on daily automatic backups',
  'Sao lưu file và database mỗi ngày, giữ nhiều bản. Cài đặt → Sao lưu website.': 'Files and databases every day, several copies kept. Settings → Website backups.',
  'Kết nối Cloudflare API token': 'Connect a Cloudflare API token',
  'Để Lares tự tạo bản ghi DNS cho tên miền. Cài đặt → Cloudflare.': 'Lets Lares create DNS records for your domains. Settings → Cloudflare.',
  'Kết nối': 'Connect',
  'Bắt đầu với Lares': 'Getting started with Lares',
  'Đã xong các bước chính - máy chủ đã sẵn sàng.': 'All main steps done - the server is ready.',
  '{done}/{total} bước đã xong': '{done}/{total} steps done',
  'Ẩn thẻ này (thẻ hiện lại nếu một thiết lập bảo mật bị tắt)': 'Hide this card (it comes back if a security setting is turned off)',
  'Một thiết lập bảo mật đã bị tắt sau khi bạn ẩn thẻ này - hãy kiểm tra lại.': 'A security setting was turned off after you hid this card - please check it.',
  'đã xong': 'done',
  'chưa xong': 'not done',
  'tuỳ chọn': 'optional',
};
