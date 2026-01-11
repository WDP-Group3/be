# Hướng dẫn tạo tài khoản Admin

## Tạo tài khoản Admin mẫu

Để tạo tài khoản Admin mẫu, chạy lệnh sau:

```bash
npm run create-admin
```

Tài khoản Admin mặc định:
- **Email**: `admin@drivecenter.com`
- **Password**: `Admin123!@#`

⚠️ **Lưu ý**: Sau khi đăng nhập, vui lòng đổi mật khẩu ngay!

## Phân quyền các Role

Hệ thống hỗ trợ các role sau:

### ADMIN
- Toàn quyền truy cập hệ thống
- Quản lý users (xem, chỉnh sửa, xóa)
- Quản lý tất cả dữ liệu
- Menu hiển thị: Tất cả các menu

### CONSULTANT
- Xem và quản lý khóa học
- Xem và quản lý hồ sơ đăng ký
- Xem và quản lý học phí
- Xem thông báo
- Menu hiển thị: Tổng quan, Khóa học, Hồ sơ & đăng ký, Học phí, Thông báo

### INSTRUCTOR
- Xem tổng quan
- Quản lý lịch học (đặt/hủy lịch)
- Xem thông báo
- Menu hiển thị: Tổng quan, Lịch học, Thông báo

### STUDENT
- Xem tổng quan
- Xem khóa học
- Quản lý hồ sơ đăng ký
- Xem học phí
- Quản lý lịch học
- Thi thử
- Xem thông báo
- Menu hiển thị: Tổng quan, Khóa học, Hồ sơ & đăng ký, Học phí, Lịch học, Thi thử, Thông báo

## API Endpoints

### Admin APIs (Yêu cầu authentication + ADMIN role)
- `GET /api/admin/users` - Lấy danh sách users
- `PUT /api/admin/users/:id/status` - Cập nhật status user
- `PUT /api/admin/users/:id/role` - Cập nhật role user
- `DELETE /api/admin/users/:id` - Xóa user
