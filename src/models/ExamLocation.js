import mongoose from 'mongoose';

const examLocationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  address: {
    type: String,
    trim: true,
    default: '',
  },
  googleMapUrl: {
    type: String,
    trim: true,
    default: '',
  },
  image: {
    type: String,
    trim: true,
    default: '',
  },
}, {
  timestamps: true,
});

examLocationSchema.index({ name: 1 });

const ExamLocation = mongoose.model('ExamLocation', examLocationSchema);

export default ExamLocation;