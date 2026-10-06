import type { Dict } from '@lares/shared';

/** English for lead capture: services/leads.ts, leadNotify.ts, routes/leads.ts and @lares/shared leads.ts */
export const LEADS_EN: Dict = {
  // @lares/shared leads.ts
  'Mới': 'New',
  'Đã liên hệ': 'Contacted',
  'Hoàn tất': 'Done',
  'Ghi chú tối đa 2000 ký tự': 'Notes can be at most 2000 characters',
  'Bot token không hợp lệ (dạng 123456789:ABC...)': 'Invalid bot token (looks like 123456789:ABC...)',
  'Chat ID không hợp lệ (số, ví dụ 123456789 hoặc -100123..., hoặc @tenkenh)': 'Invalid chat ID (a number such as 123456789 or -100123..., or @channelname)',
  'URL webhook phải bắt đầu bằng https:// hoặc http://': 'Webhook URL must start with https:// or http://',
  'Tên header chỉ gồm chữ, số và dấu gạch ngang': 'Header name may only contain letters, digits and dashes',

  // Form contract (public endpoint)
  'Họ tên': 'Name',
  'Số điện thoại': 'Phone',
  'Công ty': 'Company',
  'Dịch vụ': 'Service',
  'Lời nhắn': 'Message',
  'Trang': 'Page',
  'Dữ liệu gửi lên không hợp lệ': 'The submitted data is invalid',
  '{field} quá dài (tối đa {max} ký tự)': '{field} is too long (at most {max} characters)',
  'Vui lòng nhập số điện thoại hoặc email': 'Please enter a phone number or an email address',
  'Chỉ nhận yêu cầu từ máy chủ nội bộ': 'Only requests from this server are accepted',
  'Website này chưa nhận form liên hệ': 'This website does not accept contact forms',
  'Bạn đã gửi quá nhiều lần, vui lòng thử lại sau ít phút': 'You have sent too many requests, please try again in a few minutes',
  'Website đang nhận quá nhiều yêu cầu, vui lòng thử lại sau': 'This website is receiving too many requests, please try again later',
  'Nội dung gửi quá lớn': 'The submission is too large',
  'Định dạng dữ liệu không được hỗ trợ': 'Unsupported data format',

  // Inbox, CSV
  'Không tìm thấy khách liên hệ': 'Contact request not found',
  'Thời gian': 'Time',
  'Trạng thái': 'Status',
  'Ghi chú': 'Note',

  // Settings
  'Bật Telegram cần có bot token và chat ID': 'Telegram needs a bot token and a chat ID',
  'Bật webhook cần có URL': 'The webhook needs a URL',

  // nginx vhosts
  'Đã thêm địa chỉ nhận form liên hệ vào {count} vhost': 'Added the contact form endpoint to {count} vhost(s)',
  'Không cập nhật được vhost cho form liên hệ, thử từng site: {error}': 'Could not update the vhosts for contact forms, retrying site by site: {error}',
  'Bỏ qua vhost {domain}: {error}': 'Skipped vhost {domain}: {error}',

  // Notifications
  'Thử thông báo khách liên hệ': 'Test contact notification',
  'Khách liên hệ mới': 'New contact request',
  'Điện thoại': 'Phone',
  'hết thời gian chờ ({seconds} giây)': 'timed out ({seconds} seconds)',
  'Lỗi mạng: {error}': 'Network error: {error}',
  'Chưa tìm thấy chat: hãy nhắn /start cho bot (hoặc thêm bot vào nhóm) rồi kiểm tra lại Chat ID.': 'Chat not found: send /start to the bot (or add the bot to the group), then check the chat ID.',
  'Bot token sai hoặc đã bị thu hồi - tạo lại token trong @BotFather.': 'The bot token is wrong or was revoked - create a new token with @BotFather.',
  'Người nhận đã chặn bot - mở chat với bot và bấm Bỏ chặn / Start.': 'The recipient blocked the bot - open the chat with the bot and tap Unblock / Start.',
  'Bot chưa có quyền gửi tin trong nhóm/kênh này.': 'The bot is not allowed to post in this group/channel.',
  'Chưa bật kênh thông báo nào cho site này': 'No notification channel is enabled for this site',
  'Kênh thông báo đã bị tắt hoặc chưa cấu hình': 'The notification channel is disabled or not configured',
  'Nguyễn Văn A': 'Jane Doe',
  'Tư vấn': 'Consulting',
  'Đây là tin nhắn thử từ Lares Panel. Nếu bạn nhận được, thông báo khách liên hệ đã hoạt động.': 'This is a test message from Lares Panel. If you can read it, contact notifications work.',
  'Đã gửi tin nhắn thử tới Telegram': 'Test message sent to Telegram',
  'Webhook đã nhận dữ liệu thử': 'The webhook accepted the test data',
  'Nhập bot token trước': 'Enter the bot token first',
  'Bot đang dùng webhook nên không đọc được tin nhắn - tắt webhook của bot (deleteWebhook) hoặc nhập Chat ID thủ công.': 'The bot uses a webhook, so its messages cannot be read - remove the webhook (deleteWebhook) or enter the chat ID by hand.',
  'Đã xoá {count} khách liên hệ quá hạn lưu trữ': 'Deleted {count} contact request(s) past the retention period',
};
