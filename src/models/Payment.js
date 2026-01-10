import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  method: {
    type: String,
    enum: ['CASH', 'TRANSFER', 'ONLINE'],
    required: true,
  },
  receivedBy: {
    type: String,
    enum: ['SYSTEM', 'CONSULTANT'],
    required: true,
  },
  paidAt: {
    type: Date,
    default: Date.now,
  },
  note: {
    type: String,
    trim: true,
  },
}, {
  timestamps: false,
});

// Indexes
paymentSchema.index({ registrationId: 1 });
paymentSchema.index({ paidAt: -1 });

const Payment = mongoose.model('Payment', paymentSchema);

export default Payment;

