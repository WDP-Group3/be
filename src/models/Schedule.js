import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema({
  instructorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  // Slot quy định: 1 (7h-9h), 2 (9h-11h), 3 (13h-15h), 4 (15h-17h)
  timeSlot: {
    type: Number, 
    required: true,
  },
  type: {
    type: String,
    enum: ['BUSY', 'AVAILABLE'], 
    default: 'BUSY'
  },
  note: String
}, { timestamps: true });

// Index để tìm nhanh và tránh trùng lặp
scheduleSchema.index({ instructorId: 1, date: 1, timeSlot: 1 }, { unique: true });

const Schedule = mongoose.model('Schedule', scheduleSchema);
export default Schedule;