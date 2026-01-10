import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
  },
  estimatedEndDate: {
    type: Date,
    required: true,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  instructorIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: [],
  },
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED'],
    default: 'OPEN',
  },
}, {
  timestamps: false,
});

// Indexes
batchSchema.index({ courseId: 1 });
batchSchema.index({ status: 1 });
batchSchema.index({ startDate: 1 });

const Batch = mongoose.model('Batch', batchSchema);

export default Batch;

