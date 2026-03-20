import mongoose from 'mongoose';

const salaryColumnConfigSchema = new mongoose.Schema({
  // Tên hiển thị cột (VD: "Hồ sơ A1", "Hỗ trợ xăng xe", "Thưởng tháng")
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // Mã khóa để refer trong code (VD: "course_a1", "support_fuel", "bonus")
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  // Loại: 'course' (theo khóa), 'allowance' (hỗ trợ), 'deduction' (khấu trừ), 'bonus' (thưởng)
  type: {
    type: String,
    enum: ['course', 'allowance', 'deduction', 'bonus'],
    required: true,
  },
  // Áp dụng cho role: INSTRUCTOR, CONSULTANT, ALL
  applyToRoles: [{
    type: String,
    enum: ['INSTRUCTOR', 'CONSULTANT', 'ALL'],
  }],
  // Mặc định = true, admin có thể tắt đi
  isActive: {
    type: Boolean,
    default: true,
  },
  // Thứ tự hiển thị trên bảng lương
  order: {
    type: Number,
    default: 0,
  },
  // Mô tả
  description: {
    type: String,
    trim: true,
    default: '',
  },
  // Khóa học liên kết (nếu type = 'course')
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    default: null,
  },
  // Giá trị mặc định / công thức (cho deductions/allowances)
  defaultValue: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

salaryColumnConfigSchema.index({ code: 1 }, { unique: true });
salaryColumnConfigSchema.index({ isActive: 1, order: 1 });
salaryColumnConfigSchema.index({ applyToRoles: 1 });

const SalaryColumnConfig = mongoose.model('SalaryColumnConfig', salaryColumnConfigSchema);

export default SalaryColumnConfig;
