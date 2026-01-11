# Hướng dẫn cấu hình Email Service

Hệ thống hỗ trợ gửi email để đặt lại mật khẩu. Bạn có thể cấu hình để sử dụng email doanh nghiệp (như @fpt.edu.vn) hoặc email cá nhân (Gmail).

## Cấu hình trong file `.env`

Thêm các biến sau vào file `be/.env`:

### 1. Email Gmail (Cá nhân)

```env
# SMTP Configuration - Gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@drivecenter.com
FRONTEND_URL=http://localhost:5173
```

**⚠️ QUAN TRỌNG - Gmail có yêu cầu bảo mật:**

**KHÔNG PHẢI Gmail nào cũng gửi được ngay!** Bạn cần làm các bước sau:

1. **Bật 2-Step Verification (Bắt buộc)**
   - Vào [Google Account Security](https://myaccount.google.com/security)
   - Bật "2-Step Verification"
   - Nếu không bật, bạn sẽ không thể tạo App Password

2. **Tạo App Password (Bắt buộc)**
   - Vào [App Passwords](https://myaccount.google.com/apppasswords)
   - Chọn app: "Mail"
   - Chọn device: "Other (Custom name)" → nhập "Drive Center"
   - Copy mật khẩu 16 ký tự được tạo
   - Sử dụng mật khẩu này cho `SMTP_PASS`, KHÔNG dùng mật khẩu Gmail thường

3. **Lưu ý:**
   - Mật khẩu thường của Gmail sẽ KHÔNG hoạt động
   - Mỗi App Password chỉ hiển thị 1 lần, lưu lại cẩn thận
   - Có thể tạo nhiều App Password cho nhiều ứng dụng
   - Nếu quên App Password, tạo lại cái mới

**Tại sao Gmail yêu cầu điều này?**
- Bảo mật tài khoản tốt hơn
- Ngăn ứng dụng bên thứ ba truy cập trực tiếp bằng mật khẩu
- Cho phép vô hiệu hóa từng ứng dụng riêng biệt nếu cần

### 2. Email FPT (@fpt.edu.vn) - Doanh nghiệp

```env
# SMTP Configuration - FPT Email
SMTP_HOST=mail.fpt.vn
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@fpt.edu.vn
SMTP_PASS=your-password
SMTP_FROM=noreply@drivecenter.com
FRONTEND_URL=http://localhost:5173
```

**Hoặc nếu sử dụng SMTP server khác:**

```env
# SMTP Configuration - FPT Email (Alternative)
SMTP_HOST=smtp.fpt.vn
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@fpt.edu.vn
SMTP_PASS=your-password
SMTP_FROM=noreply@drivecenter.com
FRONTEND_URL=http://localhost:5173
```

**Lưu ý với FPT Email:**
- Sử dụng email và mật khẩu đầy đủ của tài khoản FPT
- Port 587 sử dụng TLS (khuyến nghị)
- Port 465 sử dụng SSL (nếu cần, đặt `SMTP_SECURE=true`)

### 3. Email Server khác

```env
# SMTP Configuration - Custom Server
SMTP_HOST=your-smtp-server.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yourdomain.com
SMTP_PASS=your-password
SMTP_FROM=noreply@drivecenter.com
FRONTEND_URL=http://localhost:5173
```

## Các biến môi trường

| Biến | Mô tả | Bắt buộc | Mặc định |
|------|-------|----------|----------|
| `SMTP_HOST` | SMTP server hostname | Có (production) | - |
| `SMTP_PORT` | SMTP server port | Không | 587 |
| `SMTP_SECURE` | Sử dụng SSL/TLS (`true`/`false`) | Không | `false` |
| `SMTP_USER` | Email đăng nhập SMTP | Có (production) | - |
| `SMTP_PASS` | Mật khẩu SMTP | Có (production) | - |
| `SMTP_FROM` | Email người gửi hiển thị | Không | `noreply@drivecenter.com` |
| `FRONTEND_URL` | URL frontend để tạo reset link | Không | `http://localhost:5173` |

## Chế độ Development

Nếu không cấu hình SMTP trong môi trường development, hệ thống sẽ:
- Log email ra console (không gửi email thật)
- Hiển thị reset URL trong console để test
- Cho phép test chức năng mà không cần cấu hình email

## Kiểm tra cấu hình

Sau khi cấu hình, khởi động lại server:

```bash
npm run dev
```

Khi có yêu cầu đặt lại mật khẩu, kiểm tra:
- **Development**: Xem console log để thấy reset URL
- **Production**: Kiểm tra inbox email

## Troubleshooting

### Lỗi: "Email service chưa được cấu hình"
- Kiểm tra file `.env` đã có đầy đủ `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- Đảm bảo không có khoảng trắng thừa trong file `.env`

### Lỗi: "Authentication failed"
- Kiểm tra `SMTP_USER` và `SMTP_PASS` đúng chưa
- Với Gmail: Sử dụng App Password, không dùng mật khẩu thường
- Với FPT: Đảm bảo tài khoản email đã được kích hoạt

### Lỗi: "Connection timeout"
- Kiểm tra `SMTP_HOST` và `SMTP_PORT` đúng chưa
- Kiểm tra firewall có chặn port không
- Thử port 465 với `SMTP_SECURE=true`

### Email không được gửi
- Kiểm tra logs trong console để xem lỗi chi tiết
- Kiểm tra spam folder
- Với FPT: Liên hệ IT để đảm bảo SMTP được phép gửi từ server của bạn
