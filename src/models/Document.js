import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: false,
    default: null,
  },
  cccdImage: {
    type: String,
    trim: true,
  },
  healthCertificate: {
    type: String,
    trim: true,
  },
  photo: {
    type: String,
    trim: true,
  },
  cccdNumber: {
    type: String,
    trim: true,
  },
  consultantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  consultantEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: null,
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING',
  },
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: false,
});

// Indexes
documentSchema.index({ studentId: 1 }, { unique: true });
documentSchema.index({ registrationId: 1 });
documentSchema.index({ consultantId: 1 });
documentSchema.index({ status: 1 });
documentSchema.index({ isDeleted: 1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;

