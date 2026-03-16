import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  orderInfo: {
    type: String,
    trim: true,
  },
  transferContent: {
    type: String,
    trim: true,
    required: true,
  },
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    default: null,
  },
  scheduleIndex: {
    type: Number,
    default: null,
    min: 0,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  paymentMethod: {
    type: String,
    enum: ['SEPAY'],
    default: 'SEPAY',
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  providerTransactionId: {
    type: String,
    trim: true,
    default: null,
  },
  paidAt: {
    type: Date,
    default: null,
  },
  rawPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
}, {
  timestamps: true,
});

transactionSchema.index({ transferContent: 1 }, { unique: true });
transactionSchema.index({ user: 1, status: 1 });
transactionSchema.index({ registrationId: 1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
