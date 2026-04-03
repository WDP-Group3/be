import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  learnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  date: { type: Date, required: true },
  timeSlot: { type: String, required: true, trim: true },
  
  // --- THÊM TRƯỜNG NÀY VÀO ---
  type: {
    type: String,
    enum: ['PRACTICE', 'THEORY', 'MOCK_TEST', 'NIGHT_DRIVING'],
    default: 'PRACTICE', // Mặc định là Thực hành
  },

  // Trạng thái buổi học
  status: {
    type: String,
    enum: ['BOOKED', 'CANCELLED', 'COMPLETED', 'ABSENT'],
    default: 'BOOKED',
  },

  // --- PHẦN ĐIỂM DANH (UC25) ---
  attendance: {
    type: String,
    enum: ['PENDING', 'PRESENT', 'ABSENT'],
    default: 'PENDING',
  },
  attendanceReminderSent: {
    type: Boolean,
    default: false,
  },
  instructorNote: { type: String, trim: true },

  // --- PHẦN ĐÁNH GIÁ (UC26) ---
  rating: { type: Number, min: 1, max: 5 },
  learnerFeedback: { type: String, trim: true },
  feedbackDate: { type: Date },
  
  // Các field mở rộng cho hệ thống khiếu nại
  feedbackType: {
    type: String,
    enum: ['NORMAL', 'COMPLAINT'],
    default: 'NORMAL'
  },
  feedbackStatus: {
    type: String,
    enum: ['READ', 'UNREAD'],
    default: 'UNREAD'
  },
  feedbackUpdatedAt: { type: Date }
}, {
  timestamps: true,
});

// Thêm index cho type nếu bạn muốn lọc sau này
bookingSchema.index({ type: 1 });
bookingSchema.index({ learnerId: 1 });
bookingSchema.index({ instructorId: 1 });
bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });

// CHÚ Ý: ĐỂ CHẶN RACE CONDITION
// 1. Giáo viên chỉ dạy 1 học viên/lớp tại 1 thời điểm
bookingSchema.index(
  { instructorId: 1, date: 1, timeSlot: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'CANCELLED' } } }
);

// 2. Học viên chỉ học 1 giáo viên tại 1 thời điểm
bookingSchema.index(
  { learnerId: 1, date: 1, timeSlot: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'CANCELLED' } } }
);

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;
