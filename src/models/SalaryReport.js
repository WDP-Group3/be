import mongoose from 'mongoose';

const salaryReportSchema = new mongoose.Schema({
  // Tháng/năm của báo cáo
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  year: {
    type: Number,
    required: true,
  },

  // Người được tính lương
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // Role tại thời điểm tính lương
  role: {
    type: String,
    enum: ['INSTRUCTOR', 'CONSULTANT'],
    required: true,
  },

  // Tổng giờ dạy (chỉ dùng cho INSTRUCTOR)
  totalTeachingHours: {
    type: Number,
    default: 0,
  },

  // Tổng số buổi đã điểm danh PRESENT (INSTRUCTOR)
  totalTeachingSessions: {
    type: Number,
    default: 0,
  },

  // Tổng hoa hồng
  totalCommission: {
    type: Number,
    default: 0,
  },

  // Tổng lương = lương theo giờ + hoa hồng
  totalSalary: {
    type: Number,
    default: 0,
  },

  // Số lượng hồ sơ theo từng course
  courseCounts: [{
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
    },
    courseCode: {
      type: String,
    },
    courseName: {
      type: String,
    },
    count: {
      type: Number,
      default: 0,
    },
  }],

  // Số buổi dạy chi tiết theo ngày (cho export)
  teachingDetails: [{
    date: Date,
    timeSlot: String,
    LEARNERName: String,
    hours: Number,
    amount: Number,
  }],

  // Chi tiết hoa hồng hồ sơ (cho export)
  commissionDetails: [{
    courseCode: String,
    courseName: String,
    LEARNERName: String,
    registrationDate: Date,
    commissionAmount: Number,
  }],

  // Cấu hình lương được sử dụng để tính
  configId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalaryConfig',
  },

  // Trạng thái: DRAFT, PUBLISHED, LOCKED
  status: {
    type: String,
    enum: ['DRAFT', 'PUBLISHED', 'LOCKED'],
    default: 'DRAFT',
  },

  // Người tạo/xuất báo cáo
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Ghi chú
  note: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

// Compound index để đảm bảo unique cho mỗi user mỗi tháng
salaryReportSchema.index({ month: 1, year: 1, userId: 1 }, { unique: true });
salaryReportSchema.index({ userId: 1 });
salaryReportSchema.index({ status: 1 });

const SalaryReport = mongoose.model('SalaryReport', salaryReportSchema);

export default SalaryReport;
