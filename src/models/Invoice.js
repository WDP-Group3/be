import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNo: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment',
    required: true,
  },
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration',
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  note: {
    type: String,
    trim: true,
    default: '',
  },
  issuedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: false,
});

invoiceSchema.index({ registrationId: 1 });
invoiceSchema.index({ studentId: 1 });
invoiceSchema.index({ issuedAt: -1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);

export default Invoice;
