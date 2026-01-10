import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    required: true,
  },
  registerMethod: {
    type: String,
    enum: ['ONLINE', 'CONSULTANT'],
    required: true,
  },
  status: {
    type: String,
    enum: ['NEW', 'PROCESSING', 'STUDYING', 'COMPLETED', 'CANCELLED'],
    default: 'NEW',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: false,
});

// Indexes
registrationSchema.index({ studentId: 1 });
registrationSchema.index({ batchId: 1 });
registrationSchema.index({ status: 1 });
registrationSchema.index({ createdAt: -1 });

const Registration = mongoose.model('Registration', registrationSchema);

export default Registration;

