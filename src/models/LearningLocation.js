import mongoose from 'mongoose';

const instructorAssignmentSchema = new mongoose.Schema(
  {
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
    },
  },
  { _id: false }
);

const learningLocationSchema = new mongoose.Schema(
  {
    areaName: {
      type: String,
      required: true,
      trim: true,
    },
    yardName: {
      type: String,
      trim: true,
      default: '',
    },
    googleMapAddress: {
      type: String,
      trim: true,
      default: '',
    },
    instructors: {
      type: [instructorAssignmentSchema],
      default: [],
    },
  },
  { timestamps: true }
);

learningLocationSchema.index({ areaName: 1 });
learningLocationSchema.index({ 'instructors.instructorId': 1 });

const LearningLocation = mongoose.model('LearningLocation', learningLocationSchema);
export default LearningLocation;
