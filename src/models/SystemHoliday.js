import mongoose from 'mongoose';

const systemHolidaySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Index để tìm kiếm nhanh
systemHolidaySchema.index({ startDate: 1, endDate: 1 });

const SystemHoliday = mongoose.model('SystemHoliday', systemHolidaySchema);
export default SystemHoliday;
