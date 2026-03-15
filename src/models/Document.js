import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  LEARNERId: {
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
  // Ngày tạo hồ sơ (dùng để tính hoa hồng)
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Indexes
// LEARNERId already has unique: true in schema definition, so no extra index here

documentSchema.index({ registrationId: 1 });
documentSchema.index({ consultantId: 1 });
documentSchema.index({ status: 1 });
documentSchema.index({ isDeleted: 1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;

