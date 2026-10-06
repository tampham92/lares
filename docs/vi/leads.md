# Khách liên hệ: form trên website → panel → Telegram / webhook

Mọi site do Lares quản lý đều nhận form tại `POST /_lares/lead` trên chính tên miền của site. nginx chuyển yêu cầu về panel qua `127.0.0.1`, nên form vẫn chạy khi panel đã bật giới hạn IP. Các mẫu giao diện có sẵn (Bất động sản, Doanh nghiệp, Spa, Nhà hàng, Landing page bán hàng) đã dùng sẵn địa chỉ này.

## Xem khách ở đâu

- **Khách liên hệ** trên thanh bên: khách của mọi site. Lọc theo site và trạng thái (mới, đã liên hệ, xong), tìm kiếm, ghi chú, xuất CSV (mở được bằng Excel).
- Tab **Khách liên hệ** trong từng site: khách của riêng site đó, cài thông báo riêng, và đoạn HTML mẫu để gắn form vào trang tự làm.

## Báo khách mới

Cài trong **Cài đặt → Khách liên hệ**, hoặc ghi đè riêng cho từng site.

- **Telegram**: tạo bot bằng @BotFather, dán bot token, nhắn cho bot một tin, bấm **Tìm chat ID** rồi **Gửi thử**. Số điện thoại hiện dạng `+84…` nên bấm vào là gọi.
- **Webhook**: Lares gửi JSON (kèm header bí mật nếu đặt) tới địa chỉ bạn nhập. Dùng để nối Google Sheets (card có sẵn đoạn Apps Script), Make, n8n.
- **Zalo**: chưa tích hợp trực tiếp. Gửi tin qua Zalo OA cần OA đã xác minh, token phải làm mới định kỳ và chỉ nhắn được cho người vừa tương tác. Cách làm được: webhook → Make/n8n → Zalo OA API.

Khách luôn được lưu trước rồi mới gửi thông báo. Gửi lỗi thì tự thử lại (30 giây, 2 phút, 10 phút, 30 phút, 2 giờ), kể cả sau khi panel khởi động lại.

## Gắn form vào trang tự làm

```html
<form method="post" action="/_lares/lead">
  <input name="name" placeholder="Họ tên">
  <input name="phone" placeholder="Số điện thoại" required>
  <input name="email" type="email" placeholder="Email">
  <textarea name="message" placeholder="Nội dung"></textarea>
  <input name="_hp" style="display:none" tabindex="-1" autocomplete="off">
  <button>Gửi</button>
</form>
```

Trường nhận: `name`, `phone`, `email`, `message`, `service`, `company`, `page` (tự lấy nếu bỏ trống). Cần ít nhất `phone` hoặc `email`. `_hp` là bẫy spam, phải để trống. Không có JavaScript, trình duyệt quay về trang với `#lares-sent` hoặc `#lares-error`. Gửi bằng `fetch` kèm `Accept: application/json` sẽ nhận `{"ok":true}`.

## Giới hạn và dữ liệu

- Chống spam: 5 lần/phút và 50 lần/ngày cho mỗi IP; 30 lần/phút và 1000 lần/ngày cho mỗi site.
- Dữ liệu khách chỉ nằm trong database của panel và chỉ được gửi tới các kênh thông báo bạn cài. Tự xoá sau 12 tháng (đổi được, 0 = giữ mãi).
- Nếu bạn đặt `LARES_HOST` khác `127.0.0.1`/`0.0.0.0`, nginx không gọi được panel và form sẽ lỗi.
