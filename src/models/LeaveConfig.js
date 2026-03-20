import mongoose from 'mongoose';

const leaveConfigSchema = new mongoose.Schema({
  paidLeaveDaysPerYear: { type: Number, default: 12 },
  leaveDeductionPerDay: { type: Number, default: 0 },
  applyToRole: { type: String, enum: ['INSTRUCTOR', 'ALL'], default: 'INSTRUCTOR' },
  year: { type: Number, required: true },
}, { timestamps: true });

leaveConfigSchema.index({ year: 1 }, { unique: true });

const LeaveConfig = mongoose.model('LeaveConfig', leaveConfigSchema);

export default LeaveConfig;
