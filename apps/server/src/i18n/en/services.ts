import type { Dict } from '@lares/shared';

/** English for messages in src/services/ */
export const SERVICES_EN: Dict = {
  'LỖI: {error}': 'ERROR: {error}',
  'Chưa có API key AI - thêm key trong mục Cài đặt': 'No AI API key yet - add one in Settings',
  '{name} từ chối API key ({status}): {detail}': '{name} rejected the API key ({status}): {detail}',
  '{name} báo vượt giới hạn hoặc hết credit (429): {detail}':
    '{name} reports a rate limit or exhausted credit (429): {detail}',
  '{name} không tìm thấy model hoặc endpoint (404): {detail}':
    '{name} could not find the model or endpoint (404): {detail}',
  '{name} lỗi {status}: {detail}': '{name} error {status}: {detail}',
  'Kết nối thành công, model {model} sẵn sàng': 'Connected successfully, model {model} is ready',
  'API key hợp lệ nhưng không thấy model "{model}" trong danh sách của tài khoản - kiểm tra lại tên model':
    'The API key is valid but model "{model}" is not in the account\'s model list - check the model name',
  'lỗi không xác định': 'unknown error',
  'Bài viết vượt quá giới hạn độ dài của model - hãy giảm số từ':
    'The article exceeds the model\'s length limit - reduce the word count',
  'Gemini từ chối yêu cầu ({reason}) - thử diễn đạt lại chủ đề':
    'Gemini refused the request ({reason}) - try rephrasing the topic',
  'Gemini dừng giữa chừng ({reason}) - thử lại hoặc đổi chủ đề':
    'Gemini stopped midway ({reason}) - try again or change the topic',
  'Đang viết bài bằng {model} ({provider})...': 'Writing the article with {model} ({provider})...',
  'Đã nhận {count} ký tự...': 'Received {count} characters...',
  'AI trả về dữ liệu không đúng định dạng JSON - hãy thử lại':
    'The AI returned data that is not valid JSON - please try again',
  'AI trả về bài viết thiếu dữ liệu: {issues}': 'The AI returned an incomplete article: {issues}',
  'Hoàn tất sau {seconds}s: "{title}"': 'Done in {seconds}s: "{title}"',
  'Web root {webRoot} nằm ngoài thư mục site {rootPath} - không nhân bản được':
    'Web root {webRoot} is outside the site directory {rootPath} - cannot clone',
  'Không đọc được thông tin database trong wp-config.php của {domain}':
    'Could not read the database details from wp-config.php of {domain}',
  'Database {name} của {domain} không nằm trên MySQL của Lares - không nhân bản được':
    'Database {name} of {domain} is not on Lares\'s MySQL - cannot clone',
  'Bỏ qua database {name}: không tồn tại trên MySQL của Lares':
    'Skipping database {name}: it does not exist on Lares\'s MySQL',
  'Không đủ dung lượng: cần khoảng {needed}, còn trống {free}':
    'Not enough disk space: about {needed} needed, {free} free',
  'Port {port} đang được sử dụng': 'Port {port} is already in use',
  'Đang sao chép file {from} → {to} ({size})...': 'Copying files {from} → {to} ({size})...',
  'Đã sao chép file': 'Files copied',
  'xoá database {name}': 'delete database {name}',
  'Đang sao chép database {from} → {to}...': 'Copying database {from} → {to}...',
  'Đã sao chép database {from} → {to}': 'Copied database {from} → {to}',
  'wp-config.php: trỏ sang database mới': 'wp-config.php: pointed to the new database',
  '.env: cập nhật {keys}': '.env: updated {keys}',
  'CẦN KIỂM TRA: cấu hình của site vẫn có thể trỏ tới database {from} - hãy đổi sang {to} (mật khẩu xem ở mục Database)':
    'CHECK NEEDED: the site configuration may still point to database {from} - change it to {to} (the password is under Databases)',
  'xoá service {name}': 'remove service {name}',
  'Đã khởi động {service} trên 127.0.0.1:{port} (dùng bản build của site nguồn)':
    'Started {service} on 127.0.0.1:{port} (using the source site\'s build)',
  'Lưu ý: biến NEXT_PUBLIC_* được đóng gói lúc build - nếu có giá trị chứa tên miền cũ, sửa ở tab Next.js rồi build lại.':
    'Note: NEXT_PUBLIC_* variables are baked in at build time - if any value contains the old domain, change it in the Next.js tab and rebuild.',
  'Site nguồn chưa được build: bấm "Build & khởi động" trong trang site mới.':
    'The source site has not been built: click "Build & start" on the new site\'s page.',
  'Hoàn tất nhân bản {domain} - truy cập: {url}': 'Clone of {domain} complete - open: {url}',
  'Site không tồn tại': 'Site not found',
  '{name} đang được dùng bởi site {domain}': '{name} is already used by site {domain}',
  'Thư mục {dir} đã tồn tại và không trống': 'Directory {dir} already exists and is not empty',
  'xoá {path}': 'delete {path}',
  'PHP {wanted} chưa được cài, dùng PHP {used}': 'PHP {wanted} is not installed, using PHP {used}',
  'xoá bản ghi site {domain}': 'delete site record {domain}',
  'xoá vhost {domain}': 'remove vhost {domain}',
  'đóng port {port}': 'close port {port}',
  'Đã mở port {port} trên firewall (ufw)': 'Opened port {port} on the firewall (ufw)',
  'Đã tạo vhost nginx lắng nghe port {port}': 'Created an nginx vhost listening on port {port}',
  'Đã tạo vhost nginx cho {domain}': 'Created an nginx vhost for {domain}',
  'Đã tạo database {name}': 'Created database {name}',
  'Cảnh báo: cần wp-cli trên máy chủ để cài giao diện mẫu WordPress - site được tạo với giao diện mặc định':
    'Warning: wp-cli is required on the server to install the WordPress template - the site was created with the default theme',
  'Tài khoản quản trị WordPress: {user} / {password} - đăng nhập tại {url}':
    'WordPress admin account: {user} / {password} - log in at {url}',
  'Site được tạo bởi Lares.': 'Site created by Lares.',
  'Chưa có mã nguồn: upload project Next.js vào {dir} rồi bấm "Build & khởi động".':
    'No source code yet: upload the Next.js project to {dir}, then click "Build & start".',
  'Hoàn tất tạo site - truy cập: {url}': 'Site created - open: {url}',
  'Chỉ site Next.js mới có thể build/deploy': 'Only Next.js sites can be built/deployed',
  'Site đang chạy theo port (chưa có tên miền) nên không cài được SSL. Hãy tạo site với tên miền thật.':
    'The site runs on a port (no domain yet), so SSL cannot be installed. Create the site with a real domain.',
  'nginx của Lares chưa chạy - port 80 đang do "{owner}" giữ.':
    'Lares\'s nginx is not running - port 80 is held by "{owner}".',
  'nginx của Lares chưa chạy.': 'Lares\'s nginx is not running.',
  'Let\'s Encrypt cần xác thực qua port 80: dừng web server cũ rồi chạy "systemctl enable --now nginx" trước khi cài SSL.':
    'Let\'s Encrypt validates over port 80: stop the old web server, then run "systemctl enable --now nginx" before installing SSL.',
  'Cảnh báo DNS: {warning}': 'Warning (DNS): {warning}',
  'Cảnh báo: certificate không bao gồm {names}': 'Warning: the certificate does not cover {names}',
  'Đã bật SSL cho {domain}, hết hạn {date}': 'SSL enabled for {domain}, expires {date}',
  'Đã bật SSL cho {domain}': 'SSL enabled for {domain}',
  'Site chưa bật SSL': 'SSL is not enabled for this site',
  'Chỉ gia hạn được chứng chỉ Let\'s Encrypt': 'Only Let\'s Encrypt certificates can be renewed',
  'Không vá được {domain}: {error}': 'Could not patch {domain}: {error}',
  'Hãy nhập tên miền thật': 'Enter a real domain',
  'Site đã dùng tên miền này': 'The site already uses this domain',
  'Lưu ý: thư mục {dir} đã tồn tại, site vẫn dùng thư mục hiện tại {current}':
    'Note: directory {dir} already exists, the site keeps using its current directory {current}',
  'Không xoá được vhost cũ: {error}': 'Could not remove the old vhost: {error}',
  'Không chuyển được log cũ: {error}': 'Could not move the old logs: {error}',
  'Đã gán tên miền {domains}. Tiếp theo: trỏ bản ghi DNS A về IP máy chủ, rồi cài SSL ở tab SSL.':
    'Assigned domain {domains}. Next: point the DNS A record to the server IP, then install SSL in the SSL tab.',
  'Đã giữ lại lịch sử log traffic cho tên miền mới': 'Kept the traffic log history for the new domain',
  'Bỏ qua database {name} (dùng chung với panel khác, Lares không xoá)':
    'Skipping database {name} (shared with another panel, Lares does not delete it)',
  'Đã xoá database {name}': 'Deleted database {name}',
  'Từ chối xoá thư mục ngoài {root}: {path}': 'Refusing to delete a directory outside {root}: {path}',
  'Đã xoá {path}': 'Deleted {path}',
  'Đã xoá site {domain}': 'Deleted site {domain}',
  'Chỉ áp dụng cho site WordPress': 'Only available for WordPress sites',
  'Web root trùng thư mục site - không hỗ trợ': 'The web root is the site directory itself - not supported',
  'Cần cài wp-cli trên máy chủ (installer của Lares tự cài - chạy lại install.sh)':
    'wp-cli is required on the server (the Lares installer sets it up - run install.sh again)',
  'wp-cli không trả về dữ liệu: {output}': 'wp-cli returned no data: {output}',
  'Không đọc được thông tin site ({error}) - viết bài không kèm liên kết nội bộ':
    'Could not read the site info ({error}) - writing the article without internal links',
  'Link đăng nhập không hợp lệ hoặc đã hết hạn. Hãy bấm lại nút trong Lares.':
    'The login link is invalid or has expired. Click the button in Lares again.',
  'Site chưa có tài khoản administrator.': 'The site has no administrator account.',
  'curl lỗi {code}': 'curl error {code}',
  'trả lời từ một site WordPress khác': 'answered by a different WordPress site',
  'Không tìm thấy {path} - site chưa cài WordPress xong?':
    '{path} not found - has WordPress finished installing?',
  'Port {port} đang do "{owner}" giữ chứ không phải nginx của Lares, nên {base} mở ra site của web server/panel khác ({status}). Dừng web server đó (hoặc gỡ tên miền khỏi panel cũ) rồi thử lại.':
    'Port {port} is held by "{owner}", not by Lares\'s nginx, so {base} opens a site of another web server/panel ({status}). Stop that web server (or remove the domain from the old panel) and try again.',
  '{base} không tới được WordPress của site này ({status}), trong khi nginx của Lares phục vụ đúng. Kiểm tra DNS của tên miền đã trỏ về IP VPS này chưa, hoặc CDN/proxy (Cloudflare...) đang trỏ nơi khác.':
    '{base} does not reach this site\'s WordPress ({status}), while Lares\'s nginx serves it correctly. Check that the domain\'s DNS points to this VPS\'s IP, or whether a CDN/proxy (Cloudflare...) points elsewhere.',
  'WordPress không nạp được plugin đăng nhập nhanh ({status}). Kiểm tra site có chạy được không (lỗi PHP?) và thư mục {dir} - hoặc đăng nhập thường tại {base}/wp-admin/':
    'WordPress did not load the quick-login plugin ({status}). Check that the site works (PHP error?) and the directory {dir} - or log in normally at {base}/wp-admin/',
  'Đang tải WordPress...': 'Downloading WordPress...',
  'Đang chạy wp core install...': 'Running wp core install...',
  'Hoàn tất cài WordPress tại {url}': 'Finish the WordPress setup at {url}',
  'Đã đổi URL WordPress qua database: {from} → {to} (widget/page-builder có thể còn link cũ - nên chạy wp search-replace khi có wp-cli)':
    'Changed the WordPress URL via the database: {from} → {to} (widgets/page builders may still hold old links - run wp search-replace once wp-cli is available)',
  'không đọc được URL hiện tại (option home)': 'could not read the current URL (option home)',
  'Đã đổi URL WordPress: {from} → {to}': 'Changed the WordPress URL: {from} → {to}',
  'Cảnh báo: wp-cli không đổi được URL ({error}) - chuyển sang cập nhật trực tiếp trong database':
    'Warning: wp-cli could not change the URL ({error}) - updating the database directly instead',
  'Cảnh báo: không cập nhật được database ({error})': 'Warning: could not update the database ({error})',
  'CẦN LÀM TAY: WordPress vẫn giữ URL cũ. Chạy trên VPS: {command}':
    'MANUAL STEP NEEDED: WordPress still has the old URL. Run on the VPS: {command}',
  'Đã vá wp-config.php (giữ port trong HTTP_HOST): {file}':
    'Patched wp-config.php (keeps the port in HTTP_HOST): {file}',
  '{what} không hợp lệ: {name}': 'Invalid {what}: {name}',
  'Tên database': 'database name',
  'Tên user': 'user name',
  'Không tạo được stored procedure/function trong database mới → sao chép lại không kèm routines':
    'Could not create stored procedures/functions in the new database → copying again without routines',
  '{domain} đang trỏ về {ips}, không phải máy chủ này': '{domain} points to {ips}, not this server',
  '{domain} chưa có bản ghi DNS A': '{domain} has no DNS A record',
  'Chưa cài certbot (apt install certbot)': 'certbot is not installed (apt install certbot)',
  'Private key không khớp với certificate': 'The private key does not match the certificate',
  'Certificate hoặc private key không đọc được': 'The certificate or private key cannot be read',
  'Không reload được nginx: {error}': 'Could not reload nginx: {error}',
  'Site tạm ngưng hoạt động': 'Site suspended',
  'Site {domain} chưa được cấp port': 'Site {domain} has no port assigned',
  'Cấu hình nginx lỗi:': 'Invalid nginx configuration:',
  'nginx chưa chạy (port 80 có thể đang do web server khác giữ) - cấu hình hợp lệ, sẽ có hiệu lực khi nginx được khởi động':
    'nginx is not running (port 80 may be held by another web server) - the configuration is valid and takes effect once nginx starts',
  'Không tìm thấy package.json trong {dir}. Hãy upload mã nguồn hoặc cấu hình Git URL.':
    'package.json not found in {dir}. Upload the source code or configure a Git URL.',
  'Đã khởi động {service} trên 127.0.0.1:{port}': 'Started {service} on 127.0.0.1:{port}',
  '{dir} không trống, không thể git clone': '{dir} is not empty, cannot git clone',
  'journalctl không khả dụng': 'journalctl is not available',
  'Không có nginx trên máy - cài bằng "brew install nginx" để xem trực tiếp các site chạy theo port (http://localhost:8001)':
    'nginx is not installed on this machine - install it with "brew install nginx" to preview port-based sites directly (http://localhost:8001)',
  'nginx dev báo lỗi cấu hình: {error}': 'dev nginx reports a configuration error: {error}',
  'Không chạy được nginx dev: {error}': 'Could not start dev nginx: {error}',
  'Database không tồn tại': 'Database not found',
  'Database {name} đã tồn tại': 'Database {name} already exists',
  'Hết port trống': 'No free ports left',
  'Template "{id}" không tồn tại': 'Template "{id}" not found',
  'Template không tồn tại': 'Template not found',
  'template.json của "{id}" không hợp lệ: {error}': 'template.json of "{id}" is invalid: {error}',
  'Đã áp dụng giao diện "{id}"': 'Applied template "{id}"',
  'Đã kích hoạt theme {slug}': 'Activated theme {slug}',
  'Cảnh báo: không tải được ảnh minh hoạ cho "{title}" (VPS không truy cập được images.unsplash.com?)':
    'Warning: could not download the illustration for "{title}" (can the VPS reach images.unsplash.com?)',
  'Đã tạo {count} bài viết mẫu': 'Created {count} sample posts',
  'Đã tạo trang chủ, {count} trang và menu theo giao diện "{name}"':
    'Created the home page, {count} pages and the menu from template "{name}"',
};
