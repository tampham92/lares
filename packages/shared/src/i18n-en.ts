import type { Dict } from './i18n.js';

/**
 * English for the Vietnamese strings defined in this package: validation messages
 * of the Zod schemas and the *_LABELS / ARTICLE_TONES / MIGRATION_STEPS maps.
 * Server and web merge this into their own dictionaries.
 */
export const SHARED_EN: Dict = {
  // Validation: domains, paths, commands
  'Tên miền không hợp lệ': 'Invalid domain',
  'Tên miền không hợp lệ (hoặc nhập localhost để chạy theo port)': 'Invalid domain (or enter localhost to serve on a port)',
  'Đường dẫn phải là đường dẫn tuyệt đối': 'Path must be absolute',
  'Đường dẫn không được chứa ".."': 'Path must not contain ".."',
  'Mẫu loại trừ chỉ gồm chữ, số và . - * / _ @ +': 'Exclude patterns may only contain letters, digits and . - * / _ @ +',
  'Mẫu loại trừ không được chứa ".."': 'Exclude pattern must not contain ".."',
  'Lệnh chỉ được nằm trên 1 dòng': 'Command must be a single line',
  'Tên biến môi trường không hợp lệ': 'Invalid environment variable name',
  'Git URL phải bắt đầu bằng https:// hoặc git@': 'Git URL must start with https:// or git@',
  'Không đặt token trong Git URL, hãy dùng ô Access token': 'Do not put a token in the Git URL, use the Access token field',
  'Access token không được chứa khoảng trắng': 'Access token must not contain spaces',
  'Host không hợp lệ': 'Invalid host',
  'Không được chứa xuống dòng hoặc < >': 'Must not contain line breaks or < >',
  'Số điện thoại không hợp lệ': 'Invalid phone number',
  'Email không hợp lệ': 'Invalid email',
  'Template không hợp lệ': 'Invalid template',
  'Certificate PEM không hợp lệ': 'Invalid PEM certificate',
  'Private key PEM không hợp lệ': 'Invalid PEM private key',
  'Trang quản trị không hợp lệ': 'Invalid admin page',
  'Tên database chỉ gồm chữ, số, gạch dưới': 'Database name may only contain letters, digits and underscores',
  'Username tối đa 32 ký tự chữ/số/_': 'Username: up to 32 letters, digits or _',
  'Tên database không hợp lệ': 'Invalid database name',

  // Site types
  'HTML tĩnh': 'Static HTML',
  'Không rõ': 'Unknown',

  // AI providers & models
  'OpenAI / API tương thích OpenAI': 'OpenAI / OpenAI-compatible API',
  'Claude Sonnet 5.5 (khuyên dùng)': 'Claude Sonnet 5.5 (recommended)',
  'Claude Opus 5.5 (chất lượng cao nhất)': 'Claude Opus 5.5 (highest quality)',
  'Claude Haiku 4.5 (nhanh, rẻ)': 'Claude Haiku 4.5 (fast, cheap)',
  'Gemini 3.8 Flash (khuyên dùng)': 'Gemini 3.8 Flash (recommended)',
  'Gemini 3.1 Pro Preview (chất lượng cao nhất)': 'Gemini 3.1 Pro Preview (highest quality)',
  'Gemini 3.5 Flash-Lite (nhanh, rẻ)': 'Gemini 3.5 Flash-Lite (fast, cheap)',
  'API key không được chứa khoảng trắng': 'API key must not contain spaces',
  'Tên model không hợp lệ': 'Invalid model name',
  'Base URL phải bắt đầu bằng https://': 'Base URL must start with https://',

  // AI articles
  'Chuyên nghiệp': 'Professional',
  'Thân thiện, gần gũi': 'Friendly, approachable',
  'Thuyết phục (bán hàng)': 'Persuasive (sales)',
  'Chuyên gia, chuyên sâu': 'Expert, in-depth',
  'Nhập chủ đề bài viết': 'Enter the article topic',
  'Nhập từ khoá chính': 'Enter the main keyword',
  'Thiếu tiêu đề': 'Title is required',
  'Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang': 'Slug may only contain lowercase letters (no accents), digits and hyphens',
  'Thiếu nội dung': 'Content is required',

  // Migration: source panels
  'Tự động nhận diện': 'Auto-detect',
  'VPS thuần (Nginx/Apache, không panel)': 'Plain VPS (Nginx/Apache, no panel)',
  'Nhập thủ công': 'Enter manually',
  'Nhập IP/hostname VPS nguồn': 'Enter the source server IP/hostname',
  'Chọn ít nhất 1 site': 'Select at least 1 site',

  // Migration steps
  'Chuẩn bị & kiểm tra': 'Prepare & check',
  'Dump & nén database': 'Dump & compress database',
  'Nén mã nguồn': 'Compress source code',
  'Đồng bộ về Lares': 'Transfer to Lares',
  'Kiểm tra toàn vẹn': 'Verify integrity',
  'Tạo site trên Lares': 'Create site on Lares',
  'Khôi phục mã nguồn': 'Restore source code',
  'Khôi phục database': 'Restore database',
  'Cập nhật cấu hình ứng dụng': 'Update app configuration',
  'Nginx, phân quyền': 'Nginx, permissions',
  'Dọn dẹp file tạm': 'Clean up temp files',
};
