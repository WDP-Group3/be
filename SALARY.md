# Tính năng Quản lý Lương

## Giới thiệu

Tính năng "Quản lý lương" cho phép Admin quản lý cấu hình lương và xem bảng tổng lương hàng tháng của Instructor và Consultant. Đồng thời, Instructor và Consultant có thể xem lương cá nhân của mình.

## Mục lục

- [Tính năng](#tính-năng)
- [Cấu trúc dữ liệu](#cấu-trúc-dữ-liệu)
- [API](#api)
- [Frontend](#frontend)
- [Cách sử dụng](#cách-sử-dụng)

---

## Tính năng

### 1. Admin

- **Cấu hình lương**: Thiết lập hoa hồng theo từng khóa học (A1/A2/B1/B2) và lương theo giờ cho Instructor
- **Xem bảng tổng lương**: Filter theo tháng/năm, role (INSTRUCTOR/CONSULTANT), tìm kiếm theo tên
- **Xuất CSV**: Xuất file chi tiết lương của từng nhân viên
- **Phân trang**: Hỗ trợ phân trang khi danh sách dài

### 2. Instructor/Consultant

- **Xem lương của tôi**: Xem lương tháng trước (mặc định) hoặc các tháng khác
- **Xem chi tiết**: Xem chi tiết giờ dạy và hoa hồng
- **Xuất CSV**: Xuất file lương cá nhân

---

## Cấu trúc dữ liệu

### Models

#### SalaryConfig
```javascript
{
  courseCommissions: [
    {
      courseId: ObjectId,      // Tham chiếu Course
      commissionAmount: Number // Hoa hồng cho mỗi hồ sơ
    }
  ],
  instructorHourlyRate: Number, // Lương theo giờ (mặc định: 80000)
  effectiveFrom: Date,           // Ngày bắt đầu có hiệu lực
  effectiveTo: Date,            // Ngày hết hiệu lực (null = vô thời hạn)
  note: String
}
```

#### SalaryReport (tùy chọn - snapshot)
```javascript
{
  month: Number,           // 1-12
  year: Number,
  userId: ObjectId,        // Tham chiếu User
  role: String,            // INSTRUCTOR | CONSULTANT
  totalTeachingHours: Number,
  totalTeachingSessions: Number,
  totalCommission: Number,
  totalSalary: Number,
  courseCounts: [
    {
      courseId: ObjectId,
      courseCode: String,
      courseName: String,
      count: Number
    }
  ],
  teachingDetails: [...],
  commissionDetails: [...],
  status: String          // DRAFT | PUBLISHED | LOCKED
}
```

### Logic tính lương

#### Instructor
- **Lương giờ dạy**: Số buổi dạy đã điểm danh (`attendance: PRESENT`, `status: COMPLETED`) × Lương theo giờ

#### Consultant
- **Hoa hồng**: Mỗi hồ sơ (Document có `consultantId`) được gán cho consultant sẽ được tính hoa hồng theo khóa học

---

## API

### Cấu hình lương

| Method | Endpoint | Mô tả | Quyền |
|--------|----------|--------|--------|
| GET | `/api/salary/config` | Lấy cấu hình hiện tại | ADMIN |
| POST | `/api/salary/config` | Tạo cấu hình mới | ADMIN |
| PUT | `/api/salary/config/:id` | Cập nhật cấu hình | ADMIN |
| GET | `/api/salary/configs` | Lấy tất cả cấu hình | ADMIN |
| GET | `/api/salary/courses` | Lấy danh sách courses | All |

### Báo cáo lương

| Method | Endpoint | Mô tả | Quyền |
|--------|----------|--------|--------|
| GET | `/api/salary/monthly-summary` | Tổng lương tháng | ADMIN |
| GET | `/api/salary/detail` | Chi tiết lương user | ADMIN |
| GET | `/api/salary/export` | Xuất CSV | ADMIN |
| GET | `/api/salary/my` | Lương của tôi | INSTRUCTOR, CONSULTANT |

### Query Parameters

#### monthly-summary
```
?month=2&year=2026&role=INSTRUCTOR&search=Nguyen&page=1&limit=10
```

#### detail / export / my
```
?month=2&year=2026&userId=...
```

---

## Frontend

### Routes

| Path | Component | Role |
|------|-----------|------|
| `/admin/salary` | AdminSalary | ADMIN |
| `/portal/my-salary` | MySalary | INSTRUCTOR, CONSULTANT |

### Menu

- **Admin**: Sidebar → "Lương"
- **Portal**: Navigation → "Lương của tôi"

---

## Cách sử dụng

### 1. Admin cấu hình lương

1. Đăng nhập với quyền ADMIN
2. Vào menu **Lương** (Admin)
3. Click nút **"Cấu hình lương"**
4. Nhập:
   - Lương theo giờ (VNĐ)
   - Hoa hồng cho từng khóa học
   - Ngày hiệu lực
5. Click **"Lương"**

### 2. Admin xem bảng lương

1. Vào menu **Lương** (Admin)
2. Chọn tháng/năm (mặc định: tháng trước)
3. Lọc theo role nếu cần
4. Tìm kiếm theo tên nếu cần
5. Click **"Xuất CSV"** để tải file chi tiết

### 3. Instructor/Consultant xem lương

1. Đăng nhập với quyền INSTRUCTOR hoặc CONSULTANT
2. Vào menu **Lương của tôi**
3. Chọn tháng/năm để xem lịch sử
4. Click **"Xem chi tiết"** để xem chi tiết
5. Click **"Xuất CSV"** để tải file

---

## Export CSV

File CSV bao gồm:
- Thông tin tổng quan (tổng giờ dạy, hoa hồng, tổng lương)
- Chi tiết giờ dạy (ngày, ca, học viên, số tiền)
- Chi tiết hoa hồng (khóa học, học viên, ngày nhận, hoa hồng)

---

## Ghi chú

- **Ngày chốt lương**: Mặc định hiển thị lương tháng trước
- **Giờ dạy**: Chỉ tính các buổi đã điểm danh PRESENT và có status COMPLETED
- **Hồ sơ**: Dựa trên Document có consultantId, lọc theo tháng tạo document
