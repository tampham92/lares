import type { Dict } from '@lares/shared';

/** PHP security updates (services/phpUpdates.ts). */
export const PHPUPDATES_EN: Dict = {
  'Không làm mới được danh sách gói (apt-get update): {error}': 'Could not refresh the package lists (apt-get update): {error}',
  'Đang kiểm tra hoặc cập nhật PHP, hãy đợi lần này xong.': 'PHP updates are already being checked or installed, wait for that to finish.',
  'Không có bản cập nhật PHP nào để cài. Hãy bấm "Kiểm tra ngay" rồi thử lại.': 'There are no PHP updates to install. Click "Check now" and try again.',
  'Cập nhật PHP': 'PHP update',
  'Cài bản vá cho các gói: {packages}': 'Installing updates for: {packages}',
  'Đã cập nhật PHP.': 'PHP updated.',
  'Tự động cập nhật PHP thất bại': 'Automatic PHP update failed',
  'Lỗi: {error}': 'Error: {error}',
  'Xem cập nhật PHP': 'View PHP updates',
  'Đã tự động cập nhật PHP {branches}': 'PHP {branches} updated automatically',
  'Khởi động lại PHP-FPM {version} ({count} tiến trình chính)': 'Restarting PHP-FPM {version} ({count} master processes)',
  'PHP-FPM không chạy lại được sau khi cập nhật: {units}. Xem: journalctl -u <tên>': 'PHP-FPM did not come back after the update: {units}. See: journalctl -u <name>',
  'Tự động cập nhật PHP (task {id})': 'Automatic PHP update (task {id})',
  'Có bản vá cho PHP {versions}': 'Updates available for PHP {versions}',
  'Kho PHP (ondrej/sury) không được cập nhật bảo mật tự động của hệ điều hành cài. Cài bản vá trong Cài đặt → Cập nhật.':
    "The OS's automatic security updates skip the PHP repository (ondrej/sury). Install them under Settings → Updates.",
  '{count} site đang chạy phiên bản PHP đã hết hỗ trợ bảo mật': '{count} site(s) run a PHP version without security support',
  'PHP {versions} không còn bản vá bảo mật từ php.net. Chuyển các site sang PHP mới hơn trong trang của từng site.':
    'PHP {versions} no longer gets security fixes from php.net. Move the sites to a newer PHP on each site page.',
};
