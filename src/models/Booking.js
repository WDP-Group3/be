import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
  instructorNote: { type: String, trim: true },

  // --- PHẦN ĐÁNH GIÁ (UC26) ---
  rating: { type: Number, min: 1, max: 5 },
  studentFeedback: { type: String, trim: true },
  feedbackDate: { type: Date }
}, {
  timestamps: true,
});

// Thêm index cho type nếu bạn muốn lọc sau này
bookingSchema.index({ type: 1 });
bookingSchema.index({ studentId: 1 });
bookingSchema.index({ instructorId: 1 });
bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;