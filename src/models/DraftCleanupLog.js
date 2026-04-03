import mongoose from 'mongoose';

const draftCleanupLogSchema = new mongoose.Schema({
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
  },
  learnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  learnerEmail: {
    type: String,
    required: true,
  },
  learnerName: {
    type: String,
    required: true,
  },
  courseName: {
    type: String,
    default: 'Khóa học',
  },
  createdAt: {
    type: Date,
    required: true,
  },
  // Số ngày kể từ khi tạo DRAFT đến khi bị xóa
  daysOld: {
    type: Number,
    required: true,
  },
  // Loại thông báo: REMINDER = gửi nhắc, DELETED = đã xóa
  action: {
    type: String,
    enum: ['REMINDER', 'DELETED'],
    required: true,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: false });

// Chống spam: mỗi registration chỉ nhận 1 REMINDER và 1 DELETED
draftCleanupLogSchema.index(
  { registrationId: 1, action: 1 },
  { unique: true },
);

const DraftCleanupLog = mongoose.model('DraftCleanupLog', draftCleanupLogSchema);

export default DraftCleanupLog;
