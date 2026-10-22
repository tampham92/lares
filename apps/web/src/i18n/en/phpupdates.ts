import type { Dict } from '@lares/shared';

/** Settings > Updates > PHP updates (PhpUpdatesCard). */
export const PHPUPDATES_EN: Dict = {
  'Cập nhật PHP': 'PHP updates',
  'PHP được cài từ kho ondrej/sury nên không nằm trong cập nhật bảo mật tự động của hệ điều hành. Lares kiểm tra bản vá mỗi ngày; cập nhật chỉ trong cùng phiên bản (ví dụ 8.3.12 lên 8.3.14), giữ nguyên php.ini và cấu hình pool.':
    "PHP comes from the ondrej/sury repository, which the OS's automatic security updates skip. Lares checks for patch releases daily; updates stay within the same version (e.g. 8.3.12 to 8.3.14) and keep php.ini and the pool settings.",
  'đến {date}': 'until {date}',
  'sắp hết hạn {date}': 'ends {date}',
  'hết hỗ trợ từ {date}': 'ended {date}',
  'không rõ': 'unknown',
  'PHP đã có bản vá mới nhất.': 'PHP is up to date.',
  'Đã bật tự cập nhật PHP': 'Automatic PHP updates turned on',
  'Đã tắt tự cập nhật PHP': 'Automatic PHP updates turned off',
  'Cài bản vá PHP? PHP-FPM của các site khởi động lại (gián đoạn vài giây); php.ini và cấu hình pool được giữ nguyên.':
    "Install the PHP updates? The sites' PHP-FPM restarts (a few seconds of interruption); php.ini and the pool settings are kept.",
  'Đã cập nhật PHP.': 'PHP updated.',
  'PHP {version} đã hết hỗ trợ bảo mật từ {date} nhưng còn {count} site dùng. Đổi sang PHP mới hơn ở thẻ Cấu hình trong trang của từng site.':
    'PHP {version} lost security support on {date} but {count} site(s) still use it. Switch them to a newer PHP in the Configuration card of each site page.',
  'Bản vá': 'Update',
  'Hỗ trợ': 'Support',
  '{count} site': '{count} site(s)',
  '{version} (bản dựng mới)': '{version} (new build)',
  'Chưa có PHP-FPM nào trên máy chủ này.': 'No PHP-FPM is installed on this server.',
  'Cập nhật kèm theo: {packages}': 'Also updated: {packages}',
  'Lần cập nhật gần nhất': 'Last update',
  'thất bại': 'failed',
  'Tự cài bản vá PHP mỗi đêm (2h–6h theo giờ máy chủ)': 'Install PHP updates automatically every night (2–6 am server time)',
  'Đang kiểm tra bản vá…': 'Checking…',
  'Cài bản vá PHP {versions}': 'Update PHP {versions}',
  'Cài bản cập nhật': 'Install updates',
};
