import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
  },
  cccdImage: {
    type: String, // URL hoặc path đến file
    trim: true,
  },
  healthCertificate: {
    type: String, // URL hoặc path đến file
    trim: true,
  },
  photo: {
    type: String, // URL hoặc path đến file
    trim: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  },
}, {
  timestamps: false,
});

// Indexes
documentSchema.index({ registrationId: 1 });
documentSchema.index({ status: 1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;

