import type { Dict } from '@lares/shared';

/** English for WordPress updates: services/wpUpdates.ts, wpHealth.ts, wpUpdatePolicy.ts, routes/wpupdates.ts, @lares/shared wpupdates.ts and the update hooks in backups.ts */
export const WPUPDATES_EN: Dict = {
  // @lares/shared wpupdates.ts / backup.ts
  'Tên plugin/theme không hợp lệ': 'Invalid plugin/theme name',
  'thông báo "critical error" của WordPress': 'the WordPress "critical error" message',
  'trang lỗi của WordPress (wp_die)': 'a WordPress error page (wp_die)',
  'PHP Fatal error': 'PHP Fatal error',
  'PHP Parse error': 'PHP Parse error',
  'lỗi kết nối database': 'a database connection error',
  'chế độ bảo trì': 'maintenance mode',
  'Trước khi cập nhật WordPress': 'Before WordPress update',

  // backups.ts
  '{domain} đang cập nhật WordPress - hãy đợi nó xong': '{domain} is updating WordPress - wait for it to finish',
  'Bước 1/4: bỏ qua bản sao lưu an toàn (trạng thái hiện tại là bản cập nhật lỗi)': 'Step 1/4: skipping the safety backup (the current state is the failed update)',

  // Inventory
  'wp-cli không đọc được danh sách {kind}: {error}': 'wp-cli could not list the {kind}s: {error}',
  'wp-cli không đọc được phiên bản WordPress: {error}': 'wp-cli could not read the WordPress version: {error}',
  'Chưa chọn mục nào để cập nhật': 'Nothing selected to update',
  'Không có mục nào cần cập nhật': 'Nothing to update',

  // History
  'Bị gián đoạn vì panel khởi động lại - hãy kiểm tra site. Bản sao lưu {id} có ở tab Sao lưu.': 'Interrupted by a panel restart - check the site. Backup {id} is in the Backups tab.',
  'Bị gián đoạn vì panel khởi động lại trước khi cập nhật': 'Interrupted by a panel restart before updating',
  'Lần cập nhật WordPress #{id} bị gián đoạn khi panel khởi động lại': 'WordPress update #{id} was interrupted by the panel restart',

  // Health problems
  'Trang chủ': 'Home page',
  'không phản hồi': 'no answer',
  '{page}: {status}': '{page}: {status}',
  '{page}: {status}{title}': '{page}: {status}{title}',
  '{page}: {after} (trước khi cập nhật: {before})': '{page}: {after} (before the update: {before})',
  '{page} hiện {marker}': '{page} shows {marker}',
  '{page}: tiêu đề "{title}"': '{page}: title "{title}"',
  '{page}: tiêu đề đổi thành "{after}" (trước đó "{before}")': '{page}: title changed to "{after}" (was "{before}")',
  '{page} trả về trang trắng': '{page} returns a blank page',
  'Lỗi PHP mới trong log: {line}': 'New PHP error in the log: {line}',
  'Plugin {slug} không còn được kích hoạt': 'Plugin {slug} is no longer active',
  'Theme {slug} không còn là theme đang dùng': 'Theme {slug} is no longer the active theme',

  // Culprit
  'Cập nhật làm site lỗi - đã khôi phục lại như trước.': 'The update broke the site - it was restored to how it was.',
  'Bản cập nhật {name} làm site lỗi - đã khôi phục lại như trước.': 'The {name} update broke the site - it was restored to how it was.',
  'Đã cập nhật {count} mục cùng lúc; log lỗi PHP chỉ ra {names}. Site đã được khôi phục - hãy cập nhật từng mục một để xác nhận.':
    '{count} items were updated at once; the PHP error log points to {names}. The site was restored - update the items one by one to confirm.',
  'Đã cập nhật {count} mục cùng lúc nên chưa rõ mục nào gây lỗi ({names}). Site đã được khôi phục - hãy cập nhật từng mục một.':
    '{count} items were updated at once, so it is not clear which one broke the site ({names}). The site was restored - update the items one by one.',

  // Run log
  'Đọc phiên bản hiện tại và các bản cập nhật...': 'Reading the current versions and available updates...',
  'Bỏ qua {name}: không có bản cập nhật': 'Skipping {name}: no update available',
  'Sẽ cập nhật {count} mục:': 'Updating {count} items:',
  'Bước 1/5: ghi nhận tình trạng site trước khi cập nhật...': 'Step 1/5: recording the health of the site before the update...',
  'Cảnh báo: site đã có lỗi trước khi cập nhật ({issues}) - chỉ những lỗi mới phát sinh mới bị coi là do cập nhật':
    'Warning: the site already has problems before the update ({issues}) - only new problems will be blamed on the update',
  'Bước 2/5: sao lưu site (file + database) trước khi cập nhật...': 'Step 2/5: backing up the site (files + database) before the update...',
  'Không tạo được bản sao lưu nên đã huỷ cập nhật (site không bị thay đổi): {error}': 'The backup failed, so the update was cancelled (the site was not changed): {error}',
  'Bước 3/5: cập nhật...': 'Step 3/5: updating...',
  'Cập nhật WordPress {from} → {to}...': 'Updating WordPress {from} → {to}...',
  'Cảnh báo: wp core update-db thất bại: {error}': 'Warning: wp core update-db failed: {error}',
  'LỖI: cập nhật WordPress thất bại: {error}': 'ERROR: the WordPress update failed: {error}',
  'Cập nhật {count} plugin: {names}': 'Updating {count} plugin(s): {names}',
  'Cập nhật {count} theme: {names}': 'Updating {count} theme(s): {names}',
  'LỖI: cập nhật {name} thất bại: {error}': 'ERROR: updating {name} failed: {error}',
  'Đã gỡ chế độ bảo trì (.maintenance)': 'Took the site out of maintenance mode (.maintenance)',
  'Bước 4/5: kiểm tra lại site sau khi cập nhật...': 'Step 4/5: checking the site again after the update...',
  'phiên bản vẫn là {version}': 'version is still {version}',
  'Cảnh báo: không đọc được phiên bản sau khi cập nhật: {error}': 'Warning: could not read the versions after the update: {error}',
  'Phát hiện bất thường - kiểm tra lại sau {seconds} giây để loại trừ lỗi thoáng qua...': 'Something looks wrong - checking again in {seconds} seconds to rule out a passing glitch...',
  'Đã cập nhật {item}': 'Updated {item}',
  'Cảnh báo: không cập nhật được {name}: {error}': 'Warning: could not update {name}: {error}',
  'Không cập nhật được mục nào - site vẫn chạy như trước': 'Nothing could be updated - the site runs as before',
  'Site vẫn hoạt động bình thường. Hoàn tất cập nhật {count} mục.': 'The site still works normally. {count} item(s) updated.',
  '{count} mục không cập nhật được': '{count} item(s) could not be updated',
  'LỖI: {problem}': 'ERROR: {problem}',
  'Cảnh báo: {error}': 'Warning: {error}',
  'Bước 5/5: khôi phục bản sao lưu {id}...': 'Step 5/5: restoring backup {id}...',
  'Cập nhật làm site lỗi và khôi phục tự động thất bại: {error}. Bản sao lưu {id} vẫn còn - hãy khôi phục ở tab Sao lưu.':
    'The update broke the site and the automatic restore failed: {error}. Backup {id} is still there - restore it from the Backups tab.',
  'Cảnh báo: site vẫn lỗi sau khi khôi phục ({issues}) - lỗi có thể không do bản cập nhật, hãy kiểm tra site':
    'Warning: the site still has problems after the restore ({issues}) - they may not come from the update, check the site',
  'Site đã hoạt động lại như trước khi cập nhật': 'The site works again as it did before the update',
  'Cập nhật bị lỗi ({error}) - đã khôi phục bản sao lưu {id}.': 'The update failed ({error}) - backup {id} was restored.',
  'Cập nhật WordPress {domain}': 'Update WordPress on {domain}',
};
