import type { Dict } from '@lares/shared';

/** English for WordPress updates: components/WpUpdatesTab.tsx, @lares/shared wpupdates.ts and the pre-update backup label */
export const WPUPDATES_EN: Dict = {
  // @lares/shared
  'Tên plugin/theme không hợp lệ': 'Invalid plugin/theme name',
  'thông báo "critical error" của WordPress': 'the WordPress "critical error" message',
  'trang lỗi của WordPress (wp_die)': 'a WordPress error page (wp_die)',
  'PHP Fatal error': 'PHP Fatal error',
  'PHP Parse error': 'PHP Parse error',
  'lỗi kết nối database': 'a database connection error',
  'chế độ bảo trì': 'maintenance mode',
  'Trước khi cập nhật WordPress': 'Before WordPress update',

  // Tab label, site list badge
  'Cập nhật': 'Updates',
  'Có bản cập nhật WordPress, plugin hoặc theme': 'WordPress, plugin or theme updates available',
  '{count} cập nhật': '{count} updates',

  // Inventory
  'Cập nhật WordPress': 'WordPress updates',
  'Kiểm tra lần cuối: {date}': 'Last checked: {date}',
  'Chưa kiểm tra': 'Not checked yet',
  '{count} bản cập nhật': '{count} update(s) available',
  'Tất cả đã là bản mới nhất': 'Everything is up to date',
  'Kiểm tra lại': 'Check again',
  'Cập nhật tất cả': 'Update all',
  'Cập nhật mục đã chọn ({count})': 'Update selected ({count})',
  'Cập nhật mục đã chọn': 'Update selected',
  'Mỗi lần cập nhật, Lares ghi nhận tình trạng site, sao lưu file + database, cập nhật rồi kiểm tra lại. Nếu site lỗi sau khi cập nhật, bản sao lưu được khôi phục tự động.':
    'For every update Lares records the health of the site, backs up files + database, updates, then checks again. If the site breaks after the update, the backup is restored automatically.',
  'Lần kiểm tra gần nhất bị lỗi: {error}': 'The last check failed: {error}',
  'Đang đọc phiên bản bằng wp-cli…': 'Reading versions with wp-cli…',
  'Thành phần': 'Component',
  'Bản đang cài': 'Installed',
  'Đang dùng': 'Active',
  'Không dùng': 'Not used',
  'Bản mới': 'Available',
  'Chọn': 'Select',
  'Mới nhất': 'Up to date',
  'Plugin ({count})': 'Plugins ({count})',
  'Theme ({count})': 'Themes ({count})',
  'Đang kích hoạt': 'Active',
  'Kích hoạt toàn mạng': 'Network active',
  'Chưa kích hoạt': 'Inactive',
  'Tắt': 'Off',
  'Bật': 'On',
  'Theme cha': 'Parent theme',
  'Chọn tất cả mục có bản mới': 'Select everything with an update',
  'Tự cập nhật': 'Auto-update',
  'Chưa cài plugin nào': 'No plugins installed',
  'Chưa cài theme nào': 'No themes installed',

  // Confirmation
  'Cập nhật {count} mục trên {site}?': 'Update {count} item(s) on {site}?',
  'Các bước:': 'Steps:',
  'Bắt đầu cập nhật': 'Start update',
  'Ghi nhận tình trạng site: trang chủ, wp-login.php, log lỗi PHP': 'Record the health of the site: home page, wp-login.php, PHP error log',
  'Sao lưu toàn bộ file + database (huỷ cập nhật nếu sao lưu lỗi)': 'Back up all files + database (the update is cancelled if the backup fails)',
  'Cập nhật bằng wp-cli: core (kèm cập nhật database), plugin, theme': 'Update with wp-cli: core (with its database update), plugins, themes',
  'Kiểm tra lại site; nếu lỗi thì tự khôi phục bản sao lưu': 'Check the site again; restore the backup automatically if it is broken',
  'Nếu phải khôi phục, nội dung mới phát sinh trong lúc cập nhật (đơn hàng, bình luận...) sẽ mất. Nên cập nhật lúc ít người truy cập.':
    'If a restore is needed, content created during the update (orders, comments...) is lost. Update when traffic is low.',
  'Cập nhật nhiều mục một lúc nhanh hơn, nhưng nếu site lỗi sẽ khó biết mục nào gây ra.': 'Updating several items at once is faster, but if the site breaks it is harder to tell which one caused it.',

  // Health problems
  'Trang chủ': 'Home page',
  'không phản hồi': 'no answer',
  '{page}: {after} (trước khi cập nhật: {before})': '{page}: {after} (before the update: {before})',
  '{page} hiện {marker}': '{page} shows {marker}',
  '{page}: tiêu đề đổi thành "{after}" (trước đó "{before}")': '{page}: title changed to "{after}" (was "{before}")',
  '{page} trả về trang trắng': '{page} returns a blank page',
  'Lỗi PHP mới trong log: {line}': 'New PHP error in the log: {line}',
  'Plugin {slug} không còn được kích hoạt': 'Plugin {slug} is no longer active',
  'Theme {slug} không còn là theme đang dùng': 'Theme {slug} is no longer the active theme',
  'Bản cập nhật {name} làm site lỗi.': 'The {name} update broke the site.',
  'Đã cập nhật {count} mục cùng lúc; log lỗi PHP chỉ ra {names}. Hãy cập nhật từng mục một để xác nhận.':
    '{count} items were updated at once; the PHP error log points to {names}. Update the items one by one to confirm.',
  'Đã cập nhật {count} mục cùng lúc nên chưa rõ mục nào gây lỗi ({names}). Hãy cập nhật từng mục một.':
    '{count} items were updated at once, so it is not clear which one broke the site ({names}). Update the items one by one.',

  // History
  'Thành công': 'Success',
  'Đã hoàn tác': 'Rolled back',
  'Thất bại': 'Failed',
  'chưa chạy': 'not run',
  'bỏ qua': 'skipped',
  'Lịch sử cập nhật': 'Update history',
  'Mục': 'Items',
  'Kết quả': 'Result',
  'Chi tiết': 'Details',
  'Site vẫn lỗi sau khi khôi phục - lỗi có thể không do bản cập nhật.': 'The site still had problems after the restore - they may not come from the update.',
  'Bản sao lưu trước khi cập nhật:': 'Pre-update backup:',
  'Chưa cập nhật lần nào từ Lares': 'No updates run from Lares yet',
};
