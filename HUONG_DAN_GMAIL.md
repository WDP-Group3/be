# Hướng dẫn cấu hình Gmail để gửi email

## ⚠️ Lưu ý quan trọng

**KHÔNG PHẢI Gmail nào cũng gửi được ngay!** 

Gmail yêu cầu phải bật 2-Step Verification và tạo App Password trước khi có thể sử dụng SMTP. Đây là yêu cầu bảo mật của Google.

## Các bước cấu hình Gmail

### Bước 1: Bật 2-Step Verification

1. Đăng nhập vào [Google Account](https://myaccount.google.com/)
2. Vào phần **Security** (Bảo mật)
3. Tìm mục **2-Step Verification** (Xác minh 2 bước)
4. Click **Get Started** (Bắt đầu)
5. Làm theo hướng dẫn để bật xác minh 2 bước
   - Có thể dùng điện thoại, mã dự phòng, hoặc Google Authenticator

**⚠️ Nếu không bật 2-Step Verification, bạn sẽ KHÔNG THỂ tạo App Password!**

### Bước 2: Tạo App Password

1. Vào [App Passwords](https://myaccount.google.com/apppasswords)
   - Hoặc: Google Account → Security → 2-Step Verification → App passwords
2. Chọn **App**: "Mail"
3. Chọn **Device**: "Other (Custom name)"
4. Nhập tên: "Drive Center" (hoặc tên khác bạn muốn)
5. Click **Generate** (Tạo)
6. Google sẽ hiển thị mật khẩu 16 ký tự (ví dụ: `abcd efgh ijkl mnop`)
7. **Copy mật khẩu này ngay** - chỉ hiển thị 1 lần!
8. Lưu mật khẩu này để sử dụng cho `SMTP_PASS` trong file `.env`

### Bước 3: Cấu hình trong file `.env`

Mở file `be/.env` và thêm:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=abcdefghijklmnop
SMTP_FROM=noreply@drivecenter.com
FRONTEND_URL=http://localhost:5173
```

**Lưu ý:**
- `SMTP_USER`: Email Gmail đầy đủ (ví dụ: `yourname@gmail.com`)
- `SMTP_PASS`: App Password 16 ký tự (không có khoảng trắng)
- KHÔNG sử dụng mật khẩu Gmail thường!

### Bước 4: Khởi động lại server

```bash
cd be
npm run dev
```

## Câu hỏi thường gặp

### Q: Tại sao không dùng mật khẩu Gmail thường?

A: Google đã tắt tính năng "Less secure app access" từ năm 2022. Chỉ App Password mới hoạt động với SMTP.

### Q: App Password có an toàn không?

A: Có! App Password an toàn hơn vì:
- Chỉ dùng được cho ứng dụng cụ thể
- Có thể xóa bất cứ lúc nào
- Không ảnh hưởng đến mật khẩu chính
- Có thể tạo nhiều App Password cho nhiều ứng dụng

### Q: Tôi quên App Password thì sao?

A: Không sao! Chỉ cần:
1. Vào [App Passwords](https://myaccount.google.com/apppasswords)
2. Xóa App Password cũ
3. Tạo App Password mới
4. Cập nhật lại trong file `.env`

### Q: Tôi có nhiều Gmail, có thể dùng Gmail nào không?

A: Có! Bất kỳ Gmail nào cũng có thể dùng được, miễn là:
- ✅ Đã bật 2-Step Verification
- ✅ Đã tạo App Password
- ✅ Email vẫn còn hoạt động

### Q: Tôi dùng Gmail công ty (@company.com) thì sao?

A: Nếu là Google Workspace (G Suite):
- Có thể cần admin bật "Less secure app access" (không khuyến nghị)
- Hoặc dùng OAuth 2.0 (phức tạp hơn)
- Tốt nhất: Hỏi IT department của công ty

## Kiểm tra

Sau khi cấu hình, test bằng cách:
1. Vào trang "Quên mật khẩu"
2. Nhập email đã đăng ký
3. Kiểm tra inbox email
4. Nếu development mode: Xem console log để thấy reset URL

## Lỗi thường gặp

### "Invalid login: 535-5.7.8 Username and Password not accepted"

→ Bạn đang dùng mật khẩu Gmail thường thay vì App Password

**Giải pháp:**
1. Kiểm tra đã bật 2-Step Verification chưa
2. Tạo App Password mới
3. Copy đúng 16 ký tự (không có khoảng trắng)
4. Dán vào `SMTP_PASS`

### "Please log in via your web browser"

→ Google chặn đăng nhập từ ứng dụng mới

**Giải pháp:**
1. Đăng nhập Gmail trên trình duyệt
2. Vào [Security Checkup](https://myaccount.google.com/security-checkup)
3. Đảm bảo không có cảnh báo
4. Thử lại sau vài phút

### Không thấy mục "App passwords"

→ Chưa bật 2-Step Verification

**Giải pháp:**
1. Bật 2-Step Verification trước
2. Đợi vài phút để Google cập nhật
3. Refresh trang App Passwords
