import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  estimatedDuration: {
    type: Number, // Số tháng hoặc số giờ
  },
  estimatedCost: {
    type: Number,
  },
  location: {
    type: [String],
    default: [],
  },
  note: {
    type: String,
    trim: true,
  },
}, {
  timestamps: false,
});

// Indexes
courseSchema.index({ code: 1 });

const Course = mongoose.model('Course', courseSchema);

export default Course;

