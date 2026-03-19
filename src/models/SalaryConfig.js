import mongoose from 'mongoose';

const salaryConfigSchema = new mongoose.Schema({
  // Hoa hồng theo từng course (A1/A2/B1/B2)
  courseCommissions: [{
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
    commissionAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    // Ngày hiệu lực riêng cho từng khóa
    effectiveFrom: {
      type: Date,
      default: null,
    },
  }],

  // Lương theo giờ cho instructor
  instructorHourlyRate: {
    type: Number,
    required: true,
    default: 80000,
  },

  // Thời điểm có hiệu lực (ngày bắt đầu áp dụng)
  effectiveFrom: {
    type: Date,
    required: true,
    default: Date.now,
  },

  // Thời điểm hết hiệu lực (null = vô thời hạn)
  effectiveTo: {
    type: Date,
    default: null,
  },

  // Người tạo cấu hình
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  // Ghi chú
  note: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

// Index để lấy cấu hình hiện tại
salaryConfigSchema.index({ effectiveFrom: -1 });
salaryConfigSchema.index({ effectiveTo: 1 });

// Virtual để kiểm tra cấu hình có đang active không
salaryConfigSchema.virtual('isActive').get(function() {
  const now = new Date();
  const isAfterEffectiveFrom = this.effectiveFrom <= now;
  const isBeforeEffectiveTo = !this.effectiveTo || this.effectiveTo > now;
  return isAfterEffectiveFrom && isBeforeEffectiveTo;
});

const SalaryConfig = mongoose.model('SalaryConfig', salaryConfigSchema);

export default SalaryConfig;
