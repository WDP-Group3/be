import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  instructorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  timeSlot: {
    type: String, // Ví dụ: "08:00-10:00" hoặc "Morning"
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['BOOKED', 'CANCELLED', 'ABSENT'],
    default: 'BOOKED',
  },
}, {
  timestamps: false,
});

// Indexes
bookingSchema.index({ studentId: 1 });
bookingSchema.index({ instructorId: 1 });
bookingSchema.index({ batchId: 1 });
bookingSchema.index({ date: 1 });
bookingSchema.index({ status: 1 });

const Booking = mongoose.model('Booking', bookingSchema);

export default Booking;

