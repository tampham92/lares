import type { Dict } from '@lares/shared';

/** GitHub App card, callback page and the repo picker of Next.js sites. */
export const GITHUB_EN: Dict = {
  'Ngắt kết nối GitHub? Các site đã deploy vẫn chạy, nhưng lần pull sau từ repo private sẽ cần kết nối lại hoặc Access token.':
    'Disconnect GitHub? Deployed sites keep running, but the next pull from a private repo will need GitHub connected again or an Access token.',
  'Kết nối GitHub để chọn repo (kể cả private) khi tạo site Next.js, không cần dán token. Lares tạo một GitHub App riêng cho máy chủ này: chỉ có quyền đọc code, khoá bí mật nằm trên máy chủ của bạn.':
    'Connect GitHub to pick a repo (private ones too) when creating a Next.js site, without pasting a token. Lares creates a GitHub App for this server only: it can only read code, and its private key stays on your server.',
  'Đã cập nhật quyền truy cập repo của GitHub App.': "The GitHub App's repository access was updated.",
  'Chủ sở hữu': 'Owner',
  'Đã cài trên': 'Installed on',
  '(mọi repo)': '(all repos)',
  '(repo đã chọn)': '(selected repos)',
  'Bước cuối: cài App lên tài khoản GitHub và chọn các repo Lares được đọc.': 'Last step: install the App on your GitHub account and choose the repos Lares may read.',
  'Cài lên GitHub': 'Install on GitHub',
  'Thêm tài khoản / repo': 'Add account / repos',
  'Ngắt kết nối không xoá App trên GitHub; xoá tại': 'Disconnecting does not delete the App on GitHub; delete it on the',
  'trang cài đặt App': 'App settings page',
  'Tổ chức GitHub (tuỳ chọn)': 'GitHub organization (optional)',
  'Để trống để tạo App trên tài khoản cá nhân. Nhập tên tổ chức nếu repo thuộc tổ chức và bạn là owner.':
    'Leave blank to create the App on your personal account. Enter an organization name if the repos belong to an organization you own.',
  'Đang chuyển sang GitHub…': 'Redirecting to GitHub…',
  'Kết nối GitHub': 'Connect GitHub',
  'Quay lại Cài đặt → Tích hợp': 'Back to Settings → Integrations',
  'Đang lưu GitHub App và chuyển sang bước chọn repo…': 'Saving the GitHub App and moving on to choosing repos…',
  'Chọn repo từ GitHub': 'Pick a repo from GitHub',
  'Không tải được danh sách repo từ GitHub: {error}': 'Could not load repos from GitHub: {error}',
  'Repo GitHub': 'GitHub repo',
  'Không thấy repo?': 'Repo missing?',
  'Cấp thêm quyền cho GitHub App': 'Give the GitHub App access',
  'Đang tải danh sách repo…': 'Loading repos…',
  '— Chọn repo —': '— Choose a repo —',
  'Git URL khác…': 'Other Git URL…',
  'Cài GitHub App': 'Install the GitHub App',
  'để chọn repo từ danh sách': 'to pick a repo from a list',
  'Repo trên GitHub?': 'Repo on GitHub?',
  'để chọn repo (kể cả private) mà không cần token': 'to pick a repo (private ones too) without a token',
};
