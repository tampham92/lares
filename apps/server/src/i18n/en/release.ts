import type { Dict } from '@lares/shared';

/** Version / update check / telemetry messages. */
export const RELEASE_EN: Dict = {
  'Đã có Lares {latest} (đang chạy {version}). Nâng cấp: {command}': 'Lares {latest} is available (running {version}). Upgrade: {command}',
  'Phiên bản {version} không phải bản mới nhất đã kiểm tra. Hãy bấm "Kiểm tra ngay" rồi thử lại.':
    'Version {version} is not the latest release found. Click "Check now" and try again.',
  'Đang nâng cấp, hãy đợi lần này xong.': 'An upgrade is already running, wait for it to finish.',
  'Bắt đầu nâng cấp Lares {from} lên {to}': 'Starting the upgrade of Lares {from} to {to}',

  // ---- notification center (services/notifications.ts and its sources) ----
  'Không tìm thấy thông báo': 'Notification not found',
  'Có bản mới {version}': 'Version {version} is available',
  'Bạn đang dùng Lares {version}. Nâng cấp giữ nguyên website, database và tài khoản.': 'You are running Lares {version}. Upgrading keeps your websites, databases and accounts.',
  'Nâng cấp': 'Upgrade',
  'Xem thay đổi': 'View changes',
};
