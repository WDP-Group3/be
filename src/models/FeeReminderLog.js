import mongoose from 'mongoose';

const feeReminderLogSchema = new mongoose.Schema({
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
  },
  scheduleIndex: {
    type: Number,
    required: true,
  },
  reminderType: {
    type: String,
    enum: ['BEFORE', 'DUE_TODAY', 'OVERDUE'],
    required: true,
  },
  daysOffset: {
    type: Number,
    required: true,
  },
  learnerEmail: String,
  learnerName: String,
  courseName: String,
  installmentName: String,
  sentAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: false });

// Chống trùng: mỗi (registration + scheduleIndex + reminderType + daysOffset) chỉ gửi tối đa 1 lần
feeReminderLogSchema.index(
  { registrationId: 1, scheduleIndex: 1, reminderType: 1, daysOffset: 1 },
  { unique: true },
);

const FeeReminderLog = mongoose.model('FeeReminderLog', feeReminderLogSchema);

export default FeeReminderLog;
