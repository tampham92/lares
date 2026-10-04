import type { Dict } from '@lares/shared';

/** English for panel security: 2FA login step, SecuritySettings cards, allowlist notice */
export const SECURITY_EN: Dict = {
  // login
  'Mã xác thực': 'Verification code',
  'Mã 6 số trong ứng dụng xác thực, hoặc một mã khôi phục.': 'The 6-digit code from your authenticator app, or a recovery code.',
  'Xác nhận': 'Verify',
  'Quay lại': 'Back',
  // two-factor card
  'Mã QR': 'QR code',
  'mã khôi phục': 'recovery codes',
  'Lưu các mã khôi phục này ở nơi an toàn. Mỗi mã dùng được một lần khi mất điện thoại. Chúng chỉ hiển thị lần này.':
    'Store these recovery codes somewhere safe. Each one works once if you lose your phone. They are shown only this time.',
  'Sao chép': 'Copy',
  'Tải xuống .txt': 'Download .txt',
  'Tôi đã lưu các mã này': 'I have saved these codes',
  'Xác thực hai lớp (2FA)': 'Two-factor authentication (2FA)',
  'Đang bật': 'On',
  'Đang tắt': 'Off',
  'Ngoài mật khẩu, đăng nhập cần thêm mã 6 số từ ứng dụng xác thực (Google Authenticator, Authy, 1Password, Bitwarden…).':
    'Besides the password, logging in needs a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden…).',
  '1. Quét mã QR bằng ứng dụng xác thực, hoặc nhập khoá thủ công:': '1. Scan the QR code with your authenticator app, or enter the key manually:',
  '2. Nhập mã 6 số ứng dụng hiển thị': '2. Enter the 6-digit code the app shows',
  'Đã bật xác thực hai lớp. Các phiên đăng nhập khác đã bị đăng xuất.': 'Two-factor authentication is on. All other sessions have been logged out.',
  'Xác nhận & bật': 'Verify & enable',
  'Chỉ còn {n} mã khôi phục - hãy tạo bộ mã mới.': 'Only {n} recovery codes left - generate a new set.',
  'Còn {n} mã khôi phục chưa dùng.': '{n} unused recovery codes left.',
  'Mã 6 số từ ứng dụng hoặc mật khẩu hiện tại': '6-digit code from the app, or your current password',
  'Cần để tạo mã khôi phục mới (chỉ nhận mã) hoặc tắt 2FA.': 'Needed to generate new recovery codes (code only) or to turn 2FA off.',
  'Tạo mã khôi phục mới': 'New recovery codes',
  'Tắt xác thực hai lớp? Tài khoản sẽ chỉ còn được bảo vệ bằng mật khẩu.': 'Turn off two-factor authentication? The account will be protected by the password only.',
  'Đã tắt xác thực hai lớp': 'Two-factor authentication turned off',
  'Tắt 2FA': 'Turn off 2FA',
  'Bật xác thực hai lớp': 'Enable two-factor authentication',
  // allowlist card
  'Vẫn lưu? Bạn sẽ cần SSH vào máy chủ và chạy "lares allowlist clear" để vào lại.': 'Save anyway? You will need to SSH into the server and run "lares allowlist clear" to get back in.',
  'Đã lưu - chỉ {n} địa chỉ/dải IP này truy cập được panel.': 'Saved - only these {n} addresses/ranges can reach the panel.',
  'Đã lưu - mọi IP đều truy cập được panel.': 'Saved - every IP can reach the panel.',
  'Giới hạn IP truy cập panel': 'Panel IP allowlist',
  'Khi có danh sách, mọi IP khác nhận lỗi 403 (cả trang đăng nhập). Bỏ trống = không giới hạn.': 'When set, every other IP gets a 403 error (login page included). Empty = no restriction.',
  'IP hiện tại của bạn:': 'Your current IP:',
  '+ Thêm IP này': '+ Add this IP',
  'IP hoặc dải CIDR được phép (mỗi dòng một mục)': 'Allowed IPs or CIDR ranges (one per line)',
  'Ví dụ: 203.0.113.7, 10.0.0.0/8, 2001:db8::/32. Kết nối từ chính máy chủ (127.0.0.1, đường hầm SSH) luôn được phép.':
    'For example: 203.0.113.7, 10.0.0.0/8, 2001:db8::/32. Connections from the server itself (127.0.0.1, SSH tunnel) are always allowed.',
  // sessions card
  'Phiên đăng nhập': 'Sessions',
  'Đăng xuất mọi trình duyệt và thiết bị đang đăng nhập bằng tài khoản này, kể cả trình duyệt hiện tại. Đổi mật khẩu cũng đăng xuất các phiên khác.':
    'Log out every browser and device signed in with this account, this one included. Changing the password also logs out other sessions.',
  'Đăng xuất khỏi mọi thiết bị?': 'Log out of every device?',
  'Đăng xuất mọi nơi': 'Log out everywhere',
  'Đã đổi mật khẩu - các phiên đăng nhập khác đã bị đăng xuất': 'Password changed - other sessions have been logged out',
  // dashboard notice
  'Panel đang mở cho mọi địa chỉ IP. Nên giới hạn IP truy cập và bật xác thực hai lớp trong': 'The panel is open to every IP address. Restrict access by IP and enable two-factor authentication in',
  'Ẩn': 'Hide',
};
