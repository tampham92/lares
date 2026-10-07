import type { Dict } from '@lares/shared';

/** GitHub App connection (services/githubApp.ts, packages/shared/src/github.ts). */
export const GITHUB_EN: Dict = {
  'Địa chỉ panel không hợp lệ': 'Invalid panel address',
  'Tên tổ chức GitHub không hợp lệ': 'Invalid GitHub organization name',
  'Mã xác nhận GitHub không hợp lệ': 'Invalid GitHub confirmation code',
  'Tên repo không hợp lệ': 'Invalid repository name',
  'GitHub không nhận App này nữa (có thể App đã bị xoá trên GitHub). Hãy ngắt kết nối rồi kết nối lại.':
    'GitHub no longer accepts this App (it may have been deleted on GitHub). Disconnect and connect again.',
  'GitHub đang giới hạn số lượng yêu cầu, thử lại sau ít phút': 'GitHub is rate limiting requests, try again in a few minutes',
  'GitHub báo lỗi {status}: {detail}': 'GitHub returned an error {status}: {detail}',
  'Chưa kết nối GitHub': 'GitHub is not connected',
  'Hết thời gian chờ khi gọi API GitHub': 'Timed out calling the GitHub API',
  'Không kết nối được API GitHub: {error}': 'Cannot reach the GitHub API: {error}',
  'Đã kết nối GitHub. Ngắt kết nối trước khi tạo App mới.': 'GitHub is already connected. Disconnect before creating a new App.',
  'Phiên tạo GitHub App đã hết hạn hoặc không hợp lệ. Hãy bấm "Kết nối GitHub" lại.':
    'The GitHub App setup has expired or is invalid. Click "Connect GitHub" again.',
  'Mã xác nhận GitHub đã hết hạn hoặc đã được dùng. Hãy bấm "Kết nối GitHub" lại.':
    'The GitHub confirmation code has expired or was already used. Click "Connect GitHub" again.',
  'GitHub không cấp token cho installation {id}': 'GitHub did not issue a token for installation {id}',
  'GitHub App chưa được cấp quyền đọc repo {repo}': 'The GitHub App has no access to the repository {repo}',
};
