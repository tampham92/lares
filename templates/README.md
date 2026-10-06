# Giao diện mẫu (templates)

English: [README.en.md](README.en.md)

Mỗi thư mục con là một giao diện, dùng được cho cả site **HTML tĩnh** và **WordPress**.

## Đặt template ở đâu

| Thư mục | Dùng cho |
|---|---|
| `templates/` trong repo này | Template có sẵn của Lares. Bị **thay mới** mỗi lần cập nhật (`install.sh` chạy `git reset --hard`). Thêm vào đây nếu bạn muốn đóng góp vào repo |
| `/var/lib/lares/templates/` trên VPS | **Template riêng của bạn**: được giữ nguyên khi cập nhật Lares. Template ở đây có cùng `id` với template có sẵn sẽ thay thế template có sẵn |
| `apps/server/data/templates/` | Template riêng khi chạy dev trên máy |

Đường dẫn template riêng đổi được bằng biến `LARES_CUSTOM_TEMPLATES_DIR`. Thêm hoặc sửa xong thì mở lại form **Thêm site**, không cần khởi động lại Lares.

## Cấu trúc một template

```
nha-hang/                    ← id: chữ thường, số, dấu gạch ngang
├── template.json            ← thông tin + nội dung mẫu WordPress
├── style.css                ← CSS riêng (biến màu + các khối của template)
├── index.html               ← trang HTML tĩnh
└── wordpress/
    └── home.html            ← trang chủ WordPress (block markup)
```

Cách nhanh nhất: copy `bat-dong-san/` hoặc `doanh-nghiep/` thành thư mục mới, đổi `id` trong `template.json`, rồi sửa nội dung.

### `template.json`

```jsonc
{
  "id": "nha-hang",                       // trùng tên thư mục
  "name": "Nhà hàng",                     // hiện trong panel
  "description": "Thực đơn, đặt bàn, ...",
  "types": ["wordpress", "static"],       // bỏ "wordpress" nếu chỉ làm bản HTML
  "colors": { "primary": "#7a1f1f", "accent": "#e8b04b" },
  "previewImage": "https://...jpg",       // ảnh thu nhỏ trong panel
  "font": "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;800&display=swap",
  "defaults": {                           // dùng khi người tạo site để trống
    "siteName": "...", "tagline": "...", "phone": "...", "email": "...", "address": "..."
  },
  "wordpress": {
    "nav": [{ "label": "Thực đơn", "url": "/category/thuc-don/" }],
    "categories": [{ "slug": "thuc-don", "name": "Thực đơn" }],
    "posts": [{ "title": "...", "category": "thuc-don", "tags": ["Món chính"], "image": "https://...", "excerpt": "...", "content": "Đoạn 1\n\nĐoạn 2 có **chữ đậm**" }],
    "pages": [{ "title": "Liên hệ", "slug": "lien-he", "content": "**Hotline:** {{PHONE}}" }]
  }
}
```

`content` của bài viết/trang là văn bản thường: dòng trống tách đoạn, `**...**` là chữ đậm.

### Biến thay thế

Dùng được trong `index.html`, `wordpress/home.html` và nội dung trong `template.json`. Giá trị được escape HTML tự động.

| Biến | Giá trị |
|---|---|
| `{{SITE_NAME}}` | Tên thương hiệu |
| `{{TAGLINE}}` | Slogan / mô tả ngắn |
| `{{PHONE}}`, `{{PHONE_LINK}}` | Số điện thoại hiển thị / chỉ gồm số (dùng cho `tel:`) |
| `{{EMAIL}}`, `{{ADDRESS}}`, `{{YEAR}}` | Email, địa chỉ, năm hiện tại |
| `{{CSS}}` | (chỉ `index.html`) toàn bộ CSS: `_base.css` + `style.css` |
| `{{CAT:slug}}` | (chỉ `home.html`) ID của danh mục WordPress, dùng trong block Query Loop |

### CSS

- `_base.css` (dùng chung): container, nút `.btn-*`, header `.site-header/.nav/.logo/.menu`, `.section`, `.section-head`, `.card`, `.quotes`, form liên hệ `.contact-grid/.form`, footer `.site-footer/.footer-grid`.
- `style.css` của template phải khai báo các biến: `--primary --primary-dark --accent --accent-dark --on-accent --text --heading --muted --bg --bg-alt --border --footer-bg --radius --shadow --shadow-lg`.
- `_wp.css` chuyển block WordPress sang thiết kế (nút `wp-block-button.btn-accent`, lưới bài viết `.post-grid`, cột `.stats/.quotes`...).

### Trang chủ WordPress (`wordpress/home.html`)

Viết bằng block markup (`<!-- wp:group -->...`). Header, footer, trang bài viết/danh mục được Lares tự sinh từ `nav` và thông tin liên hệ. Mẹo:

- Dựng trang trong trình soạn thảo WordPress, sau đó **Code editor** (Ctrl+Shift+Alt+M), copy ra `home.html` rồi thay chữ bằng `{{SITE_NAME}}`...
- Danh sách bài viết theo danh mục: block `wp:query` với `"taxQuery":{"category":[{{CAT:slug}}]}` và `"className":"post-grid"`.
- Phần trang trí phức tạp có thể dùng block `wp:html`.

Kiểm tra trước khi dùng (trong repo): `npm test` kiểm tra cấu trúc block của mọi `home.html` có sẵn; với template riêng, xem trước trong panel (nút **Xem trước**).

## Form liên hệ (`/_lares/lead`)

Form của template gửi về `POST /_lares/lead` (xem [docs/vi/leads.md](../docs/vi/leads.md)). Bản HTML tĩnh chèn `{{LEAD_JS}}` để gửi bằng JavaScript và hiện thông báo ngay; không có JS thì trang quay lại với `#lares-sent` / `#lares-error` (class `.lead-msg`, `.lead-ok`, `.lead-err`, ô bẫy spam `.lares-hp`). Bản WordPress đặt form trong `wordpress/contact-form.html` và đánh dấu trang bằng `"contactForm": true` trong `pages[]` của `template.json`.

## Template dựng bằng trình tạo giao diện

Template có khoá `"builder"` trong `template.json` (ví dụ `spa`, `nha-hang`, `ban-san-pham`) được dựng từ spec đó thay cho `index.html` / `home.html`: danh sách khối, kiểu trình bày, màu thương hiệu, phong cách và nội dung mẫu với các chỗ trống `{brand}`, `{slogan}`, `{phone}`, `{email}`, `{address}`, `{city}`. Ảnh nằm trong `assets/` (kèm `CREDITS.md`), ảnh xem trước là `previewImage: "assets/thumb.webp"`. Font và chuỗi chung nằm trong `templates/_builder/`. Thiết kế lưu từ trình tạo giao diện được ghi vào thư mục template riêng (`LARES_CUSTOM_TEMPLATES_DIR`).
