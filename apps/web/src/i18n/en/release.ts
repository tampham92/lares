import type { Dict } from '@lares/shared';

/** Version badge / update notice. */
export const RELEASE_EN: Dict = {
  'Có bản mới {version}': 'New version {version}',
  'Nâng cấp trong Cài đặt': 'Upgrade in Settings',
  'Hoặc chạy lệnh sau trên VPS (website và dữ liệu được giữ nguyên):': 'Or run this on the VPS (websites and data are kept):',
  'Đã sao chép': 'Copied',
  'Sao chép': 'Copy',
  'Xem thay đổi': 'View changes',

  // Settings > Updates
  'Cập nhật Lares': 'Lares updates',
  'Bản phát hành mới được kiểm tra trên GitHub. Nâng cấp giữ nguyên website, database và tài khoản; dữ liệu của Lares được sao lưu trước khi cập nhật.':
    'New releases are checked on GitHub. Upgrading keeps your websites, databases and accounts; Lares backs up its own data first.',
  'Bản mới nhất': 'Latest release',
  'chưa kiểm tra': 'not checked yet',
  'Kiểm tra lần cuối': 'Last checked',
  'Tự kiểm tra bản mới mỗi ngày': 'Check for new releases every day',
  'Đã tắt bằng LARES_UPDATE_CHECK=0 trong /etc/lares/lares.env.': 'Turned off with LARES_UPDATE_CHECK=0 in /etc/lares/lares.env.',
  'Đã bật kiểm tra bản mới': 'Update check turned on',
  'Đã tắt kiểm tra bản mới': 'Update check turned off',
  'Không kiểm tra được (máy chủ không kết nối được GitHub?)': 'The check failed (can the server reach GitHub?)',
  'Bạn đang dùng bản mới nhất.': 'You are running the latest release.',
  'Kiểm tra ngay': 'Check now',
  'Nâng cấp lên v{version}': 'Upgrade to v{version}',
  'Nâng cấp Lares lên {version}? Website và dữ liệu được giữ nguyên; trang quản trị tạm ngắt 1-2 phút khi khởi động lại.':
    'Upgrade Lares to {version}? Websites and data are kept; the panel is unavailable for 1-2 minutes while it restarts.',
  'Trang quản trị đang khởi động lại với bản mới…': 'The panel is restarting on the new version…',
  'Đang nâng cấp lên v{version}. Có thể mất vài phút, đừng tắt máy chủ.': 'Upgrading to v{version}. This can take a few minutes, do not shut the server down.',
  'Đã nâng cấp lên v{version}. Tải lại trang để dùng giao diện mới.': 'Upgraded to v{version}. Reload the page to use the new interface.',
  'Lần nâng cấp gần nhất (v{from} lên v{to}) đã xong.': 'The last upgrade (v{from} to v{to}) finished.',
  'Tải lại trang': 'Reload page',
  'Lần nâng cấp lên v{version} bị gián đoạn.': 'The upgrade to v{version} was interrupted.',
  'Nâng cấp lên v{version} thất bại (mã lỗi {code}).': 'The upgrade to v{version} failed (exit code {code}).',
  'Xem log bên dưới, hoặc chạy lệnh nâng cấp trên VPS:': 'See the log below, or run the upgrade command on the VPS:',
};
