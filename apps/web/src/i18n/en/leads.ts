import type { Dict } from '@lares/shared';

/** English for lead capture: pages/Leads.tsx, components/Leads*.tsx, LeadNotifyFields.tsx, LeadSettingsCard.tsx, @lares/shared leads.ts */
export const LEADS_EN: Dict = {
  // @lares/shared leads.ts ('Hoàn tất' already reads "Completed" in migrations.ts)
  'Mới': 'New',
  'Đã liên hệ': 'Contacted',
  'Ghi chú tối đa 2000 ký tự': 'Notes can be at most 2000 characters',
  'Bot token không hợp lệ (dạng 123456789:ABC...)': 'Invalid bot token (looks like 123456789:ABC...)',
  'Chat ID không hợp lệ (số, ví dụ 123456789 hoặc -100123..., hoặc @tenkenh)': 'Invalid chat ID (a number such as 123456789 or -100123..., or @channelname)',
  'URL webhook phải bắt đầu bằng https:// hoặc http://': 'Webhook URL must start with https:// or http://',
  'Tên header chỉ gồm chữ, số và dấu gạch ngang': 'Header name may only contain letters, digits and dashes',

  // Sidebar, page
  'Khách liên hệ': 'Contacts',
  '{count} khách liên hệ mới': '{count} new contact request(s)',
  'Form liên hệ trên các website gửi về đây.': 'Contact forms on your websites arrive here.',
  'Tự xoá sau {months} tháng.': 'Deleted automatically after {months} months.',
  'Không tự xoá.': 'Never deleted automatically.',
  'Thông báo qua: {channels}.': 'Notifications via: {channels}.',
  'Chưa bật thông báo.': 'Notifications are off.',
  'Cài đặt thông báo': 'Notification settings',

  // Inbox
  'Tất cả website': 'All websites',
  'Mọi trạng thái': 'Any status',
  'Tìm tên, SĐT, email, nội dung…': 'Search name, phone, email, message…',
  'Xuất CSV': 'Export CSV',
  'Khách': 'Contact',
  'Lời nhắn': 'Message',
  'Chi tiết': 'Details',
  'Không có khách liên hệ phù hợp bộ lọc': 'No contact requests match the filters',
  'Chưa có khách liên hệ nào. Form liên hệ trên website gửi về sẽ hiện ở đây.': 'No contact requests yet. Submissions from your website contact forms will show up here.',
  '{from}–{to} / {total}': '{from}–{to} of {total}',
  'Trước': 'Previous',
  'Sau': 'Next',
  '{channel}: đã gửi': '{channel}: sent',
  '{channel}: đang thử lại': '{channel}: retrying',
  '{channel}: đang gửi': '{channel}: sending',
  '{channel}: lỗi': '{channel}: failed',
  'Công ty': 'Company',
  'Dịch vụ quan tâm': 'Service of interest',
  'Trang gửi form': 'Form page',
  'Thông báo': 'Notifications',
  'Thử lại lúc {time}': 'Next attempt at {time}',
  'Không gửi (chưa bật kênh thông báo nào)': 'Not sent (no notification channel enabled)',
  'Ghi chú nội bộ': 'Internal note',
  'Ví dụ: đã gọi, hẹn xem nhà thứ Bảy': 'E.g. called, viewing booked for Saturday',
  'Xoá khách liên hệ này? Không thể hoàn tác.': 'Delete this contact request? This cannot be undone.',
  'Gửi lại thông báo': 'Resend notifications',
  'Đang gửi…': 'Sending…',
  'Đã lưu': 'Saved',
  'Lưu ghi chú': 'Save note',

  // Notification fields (Settings card + site tab)
  'Gửi thông báo qua Telegram': 'Send notifications via Telegram',
  'Cách tạo bot và lấy chat ID': 'How to create a bot and find the chat ID',
  'Trong Telegram, mở @BotFather, gửi /newbot, đặt tên cho bot. BotFather trả về bot token dạng 123456789:ABC...':
    'In Telegram, open @BotFather, send /newbot and name your bot. BotFather replies with a bot token like 123456789:ABC...',
  'Mở chat với bot vừa tạo và bấm Start. Muốn cả nhóm cùng nhận: thêm bot vào nhóm rồi gửi một tin bất kỳ trong nhóm.':
    'Open a chat with the new bot and tap Start. For a whole team: add the bot to a group, then send any message in that group.',
  'Dán token vào ô bên dưới, bấm "Tìm chat ID" và chọn đúng cuộc trò chuyện (chat cá nhân là số dương, nhóm là số âm như -100...).':
    'Paste the token below, click "Find chat ID" and pick the right conversation (private chats are positive numbers, groups are negative like -100...).',
  'Bấm "Gửi thử" để kiểm tra, rồi bấm Lưu.': 'Click "Send test" to check, then Save.',
  'Xoá token': 'Remove token',
  'Token sẽ bị xoá khi bấm Lưu.': 'The token will be removed when you click Save.',
  'Chọn cuộc trò chuyện nhận thông báo:': 'Choose the conversation that receives notifications:',
  'Tìm chat ID': 'Find chat ID',
  'Gửi thử': 'Send test',
  'Chưa có ai nhắn cho bot. Mở chat với bot, bấm Start (hoặc gửi một tin trong nhóm có bot), rồi bấm lại "Tìm chat ID".':
    'Nobody has messaged the bot yet. Open the chat with the bot and tap Start (or send a message in a group that has the bot), then click "Find chat ID" again.',
  'Gửi dữ liệu tới webhook (POST JSON)': 'Send data to a webhook (POST JSON)',
  'Mỗi khách liên hệ mới được gửi dạng JSON tới URL bạn nhập. Dùng với Make, n8n, Zapier hoặc Google Apps Script để ghi vào Google Sheets, gửi email, chuyển sang Zalo...':
    'Every new contact request is posted as JSON to this URL. Use it with Make, n8n, Zapier or Google Apps Script to fill a Google Sheet, send an email, forward to Zalo...',
  'URL webhook': 'Webhook URL',
  'Header bí mật (tuỳ chọn)': 'Secret header (optional)',
  'Bên nhận kiểm tra header này để chắc chắn dữ liệu đến từ Lares': 'The receiver checks this header to make sure the data comes from Lares',
  'Giá trị bí mật': 'Secret value',
  'Đã lưu - để trống để giữ nguyên.': 'Saved - leave empty to keep it.',
  'Giá trị bí mật sẽ bị xoá khi bấm Lưu.': 'The secret will be removed when you click Save.',
  'Dữ liệu gửi đi và ví dụ Google Sheets': 'Payload and a Google Sheets example',
  'Ghi thẳng vào Google Sheets không cần Make: mở bảng tính → Tiện ích mở rộng → Apps Script, dán đoạn mã dưới đây, bấm Triển khai → Ứng dụng web (quyền truy cập: Bất kỳ ai), rồi dán URL ứng dụng web vào ô URL webhook. Giữ URL này bí mật vì ai có nó đều ghi được vào bảng.':
    'Write straight into Google Sheets without Make: open the sheet → Extensions → Apps Script, paste the code below, Deploy → Web app (access: Anyone), then paste the web app URL as the webhook URL. Keep that URL secret: anyone who has it can write to the sheet.',
  'Lares chưa gửi trực tiếp qua Zalo. Zalo không có bot miễn phí như Telegram: API Zalo Official Account (OA) cần một OA đã xác thực, access token phải làm mới định kỳ, và OA chỉ nhắn được cho người đã quan tâm (follow) và tương tác với OA gần đây. Cách nên dùng: bật Webhook ở trên, nối vào Make hoặc n8n rồi gọi API Zalo OA từ đó; hoặc nhận thông báo qua Telegram.':
    'Lares does not send to Zalo directly. Zalo has no free bot like Telegram: the Zalo Official Account (OA) API needs a verified OA, its access token must be refreshed regularly, and an OA can only message people who follow it and interacted with it recently. Recommended: enable the webhook above, connect it to Make or n8n and call the Zalo OA API from there - or get notified on Telegram.',

  // Settings card
  'Khách liên hệ (form website)': 'Contact requests (website forms)',
  'Form liên hệ trên các website do Lares quản lý gửi về': 'Contact forms on websites managed by Lares arrive in the',
  'hộp thư Khách liên hệ': 'Contacts inbox',
  'Dữ liệu chỉ lưu trong panel và chỉ được gửi tới các kênh thông báo bạn bật dưới đây. Mỗi site có thể dùng cấu hình riêng ở tab Khách liên hệ.':
    'The data stays in the panel and is only sent to the notification channels you enable below. Each site can override this in its Contacts tab.',
  'Đã lưu cấu hình khách liên hệ': 'Contact request settings saved',
  'Lưu trữ': 'Retention',
  'Tự xoá khách liên hệ sau (tháng)': 'Delete contact requests after (months)',
  'Thông tin khách là dữ liệu cá nhân: chỉ giữ trong thời gian cần thiết. 0 = không tự xoá.': 'Contact details are personal data: keep them only as long as needed. 0 = never delete.',
  'Thông báo gửi lỗi gần đây': 'Recent notification failures',
  'Sửa cấu hình rồi bấm "Gửi lại" ở từng khách trong hộp thư.': 'Fix the settings, then use "Resend notifications" on each request in the inbox.',

  // Site tab
  'Thông báo khi có khách liên hệ': 'Notify me about new contact requests',
  'Cấu hình nginx của site chưa có địa chỉ nhận form {path}. Lares tự thêm khi khởi động lại hoặc khi bạn lưu thay đổi của site (ví dụ bật/tắt access log ở tab Tổng quan).':
    "The site's nginx config does not have the form endpoint {path} yet. Lares adds it on restart or whenever the site's settings are saved (e.g. toggling the access log in the Overview tab).",
  'Gửi thông báo': 'Send notifications',
  'Dùng cấu hình chung trong Cài đặt': 'Use the shared settings',
  'Cấu hình riêng cho site này': 'Custom settings for this site',
  'Tắt thông báo cho site này': 'No notifications for this site',
  'Khách của site này được gửi tới các kênh trong': "This site's contact requests go to the channels in",
  'Cài đặt → Khách liên hệ': 'Settings → Contact requests',
  'Khách vẫn được lưu trong hộp thư, chỉ không gửi thông báo.': 'Requests are still stored in the inbox, just without notifications.',
  'Đã lưu cấu hình thông báo của site': "Site's notification settings saved",
  'Gắn form vào trang của bạn': 'Use the form on your own pages',
  'Giao diện mẫu của Lares đã có sẵn form. Với trang tự làm (HTML, WordPress, Next.js), mọi form gửi POST tới {path} trên chính tên miền {domain} đều được lưu vào đây.':
    'Lares templates already include the form. On your own pages (HTML, WordPress, Next.js), any form that POSTs to {path} on {domain} itself is stored here.',
  'Họ tên': 'Name',
  'Số điện thoại': 'Phone',
  'Gửi': 'Send',
  'Trường: name, phone, email, message, service (tuỳ chọn), page (đường dẫn trang, tuỳ chọn). Cần ít nhất số điện thoại hoặc email.':
    'Fields: name, phone, email, message, service (optional), page (page path, optional). A phone number or an email is required.',
  '_hp là bẫy chống spam: phải để trống và ẩn khỏi người xem.': '_hp is a spam trap: keep it empty and hidden from visitors.',
  'Không cần JavaScript: sau khi gửi, trình duyệt quay lại trang kèm #lares-sent (hoặc #lares-error khi lỗi). Gửi bằng fetch với header Accept: application/json sẽ nhận {"ok":true}.':
    'No JavaScript needed: after submitting, the browser returns to the page with #lares-sent (or #lares-error on failure). fetch() with an Accept: application/json header gets {"ok":true}.',
  'Chống spam: mỗi IP gửi tối đa 5 lần/phút và 50 lần/ngày.': 'Spam protection: at most 5 submissions per minute and 50 per day per IP.',
};
