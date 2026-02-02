import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // null means broadcast/all users
  },
  type: {
    type: String,
    enum: ['THEORY', 'HEALTH_CHECK', 'PHOTO', 'CABIN', 'HOLIDAY', 'OTHER'],
    required: true,
    default: 'OTHER'
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  message: { // Content of the notification
    type: String,
    required: true,
    trim: true,
  },
  expireAt: {
    type: Date,
    required: true,
  },
  isRead: { // Still useful for individual tracking if needed, but per-user read status for broadcast is complex. For now keeping simplistic.
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true, // Enable timestamps (createdAt, updatedAt)
});

// Indexes
notificationSchema.index({ userId: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ createdAt: -1 });
// TTL Index: Documents will be automatically removed after expireAt
notificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;

