import type { Dict } from '@lares/shared';

/** English for panel security: login lockout, sessions, 2FA, IP allowlist (auth/, routes/security.ts, services/security.ts, cli.ts) */
export const SECURITY_EN: Dict = {
  // @lares/shared security schemas (translated by lib/validate.ts)
  'Mã xác thực không hợp lệ': 'Invalid verification code',
  'Nhập mã xác thực hoặc mật khẩu hiện tại': 'Enter a verification code or your current password',
  // login & sessions
  'Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau {minutes} phút.': 'Account temporarily locked after too many failed logins. Try again in {minutes} minutes.',
  'Phiên xác thực đã hết hạn, vui lòng đăng nhập lại': 'The verification step has expired, please log in again',
  'Mã xác thực không đúng': 'Wrong verification code',
  // two-factor setup
  'Xác thực hai lớp đang bật. Tắt trước khi thiết lập lại.': 'Two-factor authentication is already on. Turn it off before setting it up again.',
  'Chưa bắt đầu thiết lập xác thực hai lớp': 'Two-factor setup has not been started',
  'Mã xác thực không đúng. Kiểm tra giờ trên điện thoại rồi thử lại.': "Wrong verification code. Check your phone's clock and try again.",
  'Xác thực hai lớp chưa bật': 'Two-factor authentication is not enabled',
  // IP allowlist
  '"{entry}" không phải địa chỉ IP hoặc dải CIDR hợp lệ': '"{entry}" is not a valid IP address or CIDR range',
  'Tối đa {n} mục': 'At most {n} entries',
  'Danh sách này không gồm IP hiện tại của bạn ({ip}) - lưu lại sẽ khoá chính bạn khỏi panel.': 'This list does not include your current IP ({ip}) - saving it would lock you out of the panel.',
  'Địa chỉ IP {ip} không được phép truy cập Lares Panel': 'IP address {ip} is not allowed to access Lares Panel',
  // CLI
  'Không có tài khoản "{user}"': 'No account "{user}"',
  'Đã tắt xác thực hai lớp cho "{user}"': 'Two-factor authentication turned off for "{user}"',
  '(trống - mọi IP đều vào được trang đăng nhập)': '(empty - every IP can reach the login page)',
  'Đã xoá danh sách IP được phép - mọi IP đều vào được trang đăng nhập': 'Allowlist cleared - every IP can reach the login page',
};
