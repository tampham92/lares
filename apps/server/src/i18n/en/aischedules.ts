import type { Dict } from '@lares/shared';

/** English for scheduled AI articles (services/aiSchedules.ts) */
export const AISCHEDULES_EN: Dict = {
  'Không tìm thấy lịch viết bài': 'Article schedule not found',
  'Mỗi site có tối đa {n} lịch viết bài': 'A site can have at most {n} article schedules',
  'Lịch đang viết bài - hãy đợi xong rồi xoá': 'The schedule is writing an article - wait for it to finish, then delete',
  'Lịch đang viết bài - hãy đợi xong': 'The schedule is writing an article - wait for it to finish',
  'Lần chạy này không có bài viết': 'This run has no article',
  'Lịch không còn chủ đề nào - hãy thêm chủ đề': 'The schedule has no topics left - add some',
  'Site đang có tác vụ khác (sao lưu, khôi phục, cập nhật) - đợi xong rồi mới đăng bài...':
    'The site is busy with another job (backup, restore, update) - waiting for it before posting...',
  'Site vẫn bận sau 1 giờ - bài viết được giữ trong lịch sử để đăng tay':
    'The site is still busy after 1 hour - the article is kept in the history to post by hand',
  'Viết bài tự động: {keyword}': 'Scheduled article: {keyword}',
  'Lịch "{name}" - chủ đề: {topic}': 'Schedule "{name}" - topic: {topic}',
  'Đã đăng bài #{id}: {url}': 'Published post #{id}: {url}',
  'Đã lưu bản nháp #{id}': 'Saved draft #{id}',
  'Đã đăng bài tự động lên {domain}': 'Scheduled article published on {domain}',
  'Bài viết tự động chờ duyệt trên {domain}': 'Scheduled article waiting for review on {domain}',
  '"{title}" - lịch {name}': '"{title}" - schedule {name}',
  'Viết bài tự động trên {domain} thất bại': 'Scheduled article on {domain} failed',
  'Lịch "{name}": {error}': 'Schedule "{name}": {error}',
  'Lịch viết bài "{name}" đã hết chủ đề': 'Article schedule "{name}" is out of topics',
  'Thêm chủ đề cho {domain} để lịch tiếp tục viết bài.': 'Add topics for {domain} so the schedule keeps writing.',
  'Bị gián đoạn khi panel khởi động lại': 'Interrupted by a panel restart',
};
