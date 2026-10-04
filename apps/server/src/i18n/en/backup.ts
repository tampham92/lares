import type { Dict } from '@lares/shared';

/** English for site backups: services/backups.ts, backupStorage.ts, routes/backups.ts, the backup helpers in mysql.ts and @lares/shared backup.ts */
export const BACKUP_EN: Dict = {
  // @lares/shared backup.ts
  'Thủ công': 'Manual',
  'Tự động': 'Scheduled',
  'An toàn (trước khi khôi phục)': 'Safety (before restore)',
  'Giờ phải có dạng HH:MM': 'Time must be HH:MM',

  // Settings
  'phải là đường dẫn tuyệt đối': 'must be an absolute path',
  'cần ít nhất 2 cấp thư mục, ví dụ /var/backups/lares': 'needs at least 2 directory levels, e.g. /var/backups/lares',
  'không được nằm trong thư mục hệ thống': 'must not be inside a system directory',
  'không được trùng hoặc nằm trong thư mục website {root}': 'must not be or be inside the website directory {root}',
  'Thư mục sao lưu {path} không hợp lệ: {reason}': 'Invalid backup directory {path}: {reason}',

  // Checks
  '{domain} đang có tác vụ sao lưu/khôi phục chạy - hãy đợi nó xong': '{domain} already has a backup/restore running - wait for it to finish',
  'Thư mục site {path} nằm ngoài {root} - từ chối sao lưu/khôi phục': 'Site directory {path} is outside {root} - refusing to back up/restore',
  'Tên miền {domain} không dùng được làm thư mục sao lưu': 'Domain {domain} cannot be used as a backup directory name',
  'Thư mục site {path} không tồn tại': 'Site directory {path} does not exist',
  'Cảnh báo: bỏ qua database {name} - không tồn tại trên MySQL của Lares': "Warning: skipping database {name} - it does not exist on Lares's MySQL",
  'Không đủ dung lượng để sao lưu {domain}: cần khoảng {needed}, còn trống {free} tại {path}': 'Not enough disk space to back up {domain}: needs about {needed}, {free} free at {path}',
  'Bản sao lưu không tồn tại': 'Backup not found',
  'Link tải đã hết hạn hoặc không hợp lệ': 'The download link has expired or is invalid',
  'Xác nhận không khớp tên miền của site': "Confirmation does not match the site's domain",

  // Backup log
  'Sao lưu {domain}': 'Back up {domain}',
  'Sao lưu tự động {domain}': 'Scheduled backup of {domain}',
  'Sao lưu {domain} → {path}': 'Backing up {domain} → {path}',
  'Đang nén thư mục {path} (khoảng {size})...': 'Compressing {path} (about {size})...',
  'Đã nén file: {size}': 'Files compressed: {size}',
  'Đang dump database {name}...': 'Dumping database {name}...',
  'Đã dump database {name}: {size}': 'Database {name} dumped: {size}',
  'Đã tạo bản sao lưu {id} ({size})': 'Backup {id} created ({size})',
  'Đã xoá bản sao lưu cũ {id} (giữ {keep} bản gần nhất)': 'Deleted old backup {id} (keeping the {keep} newest)',
  'Không dump được stored procedure/function của {name} → dump lại không kèm routines': 'Could not dump the stored procedures/functions of {name} → dumping again without routines',
  'File dump của {name} không hoàn chỉnh (thiếu dòng "Dump completed")': 'The dump of {name} is incomplete (no "Dump completed" line)',
  'Đã dọn {count} bản sao lưu dang dở': 'Cleaned up {count} unfinished backups',
  'Cảnh báo: thư mục sao lưu: {error}': 'Warning: backup directory: {error}',

  // Restore log
  'Khôi phục {domain} từ {id}': 'Restore {domain} from {id}',
  'Cảnh báo: bỏ qua database {name} - không thuộc site này trong Lares': 'Warning: skipping database {name} - it does not belong to this site in Lares',
  'Bản sao lưu {id} bị hỏng (manifest.json không hợp lệ)': 'Backup {id} is damaged (invalid manifest.json)',
  'Bản sao lưu {id} thuộc site {domain}, không phải site này': 'Backup {id} belongs to site {domain}, not this one',
  'Bản sao lưu {id} thiếu file {file}': 'Backup {id} is missing file {file}',
  'Kiểm tra bản sao lưu {id}...': 'Checking backup {id}...',
  'File {file} bị hỏng (gzip -t thất bại)': 'File {file} is corrupted (gzip -t failed)',
  'Không đủ dung lượng để giải nén bản sao lưu: cần khoảng {needed}, còn trống {free} tại {path}': 'Not enough disk space to extract the backup: needs about {needed}, {free} free at {path}',
  'Bước 1/4: tạo bản sao lưu an toàn của trạng thái hiện tại...': 'Step 1/4: taking a safety backup of the current state...',
  'Cảnh báo: thư mục site không tồn tại - bỏ qua bản sao lưu an toàn': 'Warning: the site directory does not exist - skipping the safety backup',
  'Bước 2/4: giải nén file ({size})...': 'Step 2/4: extracting files ({size})...',
  'Bước 3/4: thay thư mục site bằng bản khôi phục...': 'Step 3/4: swapping in the restored site directory...',
  'Dùng lại node_modules hiện có (dependencies không đổi)': 'Reusing the current node_modules (dependencies unchanged)',
  'Bước 4/4: khôi phục database...': 'Step 4/4: restoring databases...',
  'Không có database cần khôi phục': 'No databases to restore',
  'Cảnh báo: database {name} không do Lares tạo - chỉ ghi đè các bảng có trong bản sao lưu, bảng khác được giữ nguyên':
    'Warning: database {name} was not created by Lares - only the tables in the backup are overwritten, other tables are kept',
  'Đang import database {name}...': 'Importing database {name}...',
  'Đã khôi phục database {name}': 'Database {name} restored',
  'Khôi phục thất bại: {error}. Bản sao lưu an toàn {id} được giữ lại.': 'Restore failed: {error}. Safety backup {id} has been kept.',
  'Khôi phục thất bại: {error}': 'Restore failed: {error}',
  'Cảnh báo: {what} thất bại: {error}': 'Warning: {what} failed: {error}',
  'phân quyền': 'fixing permissions',
  'xoá thư mục cũ': 'removing the old directory',
  'khởi động lại {service}': 'restarting {service}',
  'Cài dependencies và build lại ứng dụng Next.js...': 'Installing dependencies and rebuilding the Next.js app...',
  'Đã khôi phục {domain} từ bản sao lưu {id}': 'Restored {domain} from backup {id}',
  'Hoàn tác: {label}': 'Rolled back: {label}',
  'LỖI: hoàn tác "{label}" thất bại: {error}': 'ERROR: rolling back "{label}" failed: {error}',
  'đặt lại thư mục site cũ': 'put the previous site directory back',
  'LỖI: không có bản sao lưu an toàn để hoàn tác database': 'ERROR: no safety backup to roll the databases back from',
  'LỖI: bản sao lưu an toàn không có database {name} - hãy kiểm tra thủ công': 'ERROR: the safety backup has no copy of database {name} - check it manually',
  'database {name}': 'database {name}',
};
