import type { Dict } from '@lares/shared';

/** English for site backups: components/BackupsTab.tsx, components/BackupSettingsCard.tsx, @lares/shared backup.ts */
export const BACKUP_EN: Dict = {
  // @lares/shared backup.ts
  'Thủ công': 'Manual',
  'Tự động': 'Scheduled',
  'An toàn (trước khi khôi phục)': 'Safety (before restore)',
  'Giờ phải có dạng HH:MM': 'Time must be HH:MM',

  // Site tab
  'Sao lưu': 'Backups',
  'Mỗi bản sao lưu gồm toàn bộ thư mục site (trừ cache, node_modules) và dump của các database thuộc site. Lưu tại':
    "Each backup holds the whole site directory (except caches and node_modules) and a dump of the site's databases. Stored in",
  'Sao lưu ngay': 'Back up now',
  'Sao lưu tự động': 'Scheduled backups',
  'Hằng ngày lúc {time} (giờ máy chủ), giữ {keep} bản gần nhất.': 'Daily at {time} (server time), keeping the {keep} newest.',
  'Đổi trong Cài đặt': 'Change in Settings',
  'Sao lưu tự động đang tắt cho toàn bộ panel.': 'Scheduled backups are turned off for the whole panel.',
  'Bật trong Cài đặt': 'Turn on in Settings',
  'Sao lưu tự động site này': 'Back up this site automatically',
  'Lần chạy tự động gần nhất:': 'Last scheduled run:',
  'thành công': 'succeeded',
  'Thời gian': 'Time',
  'Nội dung': 'Contents',
  hỏng: 'damaged',
  'File ({size})': 'Files ({size})',
  'Khôi phục': 'Restore',
  'Chưa có bản sao lưu nào': 'No backups yet',
  'Xoá bản sao lưu {id}? Không thể hoàn tác.': 'Delete backup {id}? This cannot be undone.',

  // Restore dialog
  'Khôi phục {site} về {date}?': 'Restore {site} to {date}?',
  'Toàn bộ file của site và nội dung database sẽ bị thay bằng dữ liệu trong bản sao lưu. Mọi thay đổi sau thời điểm đó sẽ mất.':
    "All of the site's files and database contents will be replaced with the data in the backup. Every change made after that moment will be lost.",
  'Trước tiên Lares tự tạo một bản sao lưu an toàn của trạng thái hiện tại (giữ lại nếu khôi phục lỗi).':
    'Lares first takes a safety backup of the current state (kept if the restore fails).',
  'Thay thư mục': 'Replace the directory',
  'Ghi đè database: {names}': 'Overwrite databases: {names}',
  'Khởi động lại ứng dụng Next.js (cài lại dependencies và build nếu cần)': 'Restart the Next.js app (reinstalling dependencies and rebuilding if needed)',

  // Settings card
  'Sao lưu website': 'Website backups',
  'Sao lưu file và database của từng site lên ổ đĩa VPS. Sao lưu thủ công, xem danh sách và khôi phục ở tab Sao lưu của mỗi site.':
    "Backs up each site's files and databases to the VPS disk. Manual backups, the backup list and restores are in each site's Backups tab.",
  'Đã lưu cấu hình sao lưu': 'Backup settings saved',
  'Tự động sao lưu tất cả site mỗi ngày': 'Back up all sites automatically every day',
  'Giờ chạy (giờ máy chủ)': 'Run at (server time)',
  'Nếu panel tắt vào giờ này, bản sao lưu chạy ngay khi panel bật lại trong ngày': 'If the panel is down at that time, the backup runs as soon as it is back the same day',
  'Giữ lại (bản / site)': 'Keep (backups per site)',
  'Chỉ tính bản tự động; bản thủ công không bị xoá tự động': 'Counts scheduled backups only; manual backups are never deleted automatically',
  'Thư mục lưu': 'Backup directory',
  'Để trống = mặc định {path}. Khi đổi thư mục, các bản cũ vẫn nằm ở thư mục cũ và không hiện trong danh sách.':
    'Empty = default {path}. After a change, existing backups stay in the old directory and no longer show in the list.',
};
