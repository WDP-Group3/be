import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema({
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    // Không bắt buộc - có thể lấy từ batchId
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    // Cho phép null - học viên có thể đăng ký trước khi được gán lớp
    default: null,
  },
  registerMethod: {
    type: String,
    enum: ['ONLINE', 'CONSULTANT'],
    required: true,
  },
  status: {
    type: String,
    enum: ['NEW', 'PROCESSING', 'STUDYING', 'COMPLETED', 'CANCELLED', 'WAITING'],
    default: 'NEW',
  },
  paymentPlanType: {
    type: String,
    enum: ['INSTALLMENT', 'FULL'],
    default: 'INSTALLMENT',
  },
  feePlanSnapshot: [
    {
      name: String,
      amount: Number,
      dueDate: Date,
      note: String,
      paymented: { type: Boolean, default: false },
    },
  ],
  firstPaymentDate: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: false,
});

// Indexes
registrationSchema.index({ learnerId: 1 });
registrationSchema.index({ batchId: 1 });
registrationSchema.index({ courseId: 1 });
registrationSchema.index({ status: 1 });
registrationSchema.index({ createdAt: -1 });

const Registration = mongoose.model('Registration', registrationSchema);

export default Registration;

