import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
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
    // feePayments ý nói đến số đợt nộp tiền, hạn nộp, bao giờ nộp tiếp, ...
    feePayments: [
      {
        name: String,
        amount: Number,

        afterPreviousPaidDays: Number,

        // hệ thống tự quản lý
        isPaid: { type: Boolean, default: false },
        paidAt: Date,
        dueDate: Date,

        // hoãn
        totalExtendedDays: { type: Number, default: 0 },

        note: String,
      },
    ],
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
  },
  {
    timestamps: false,
  },
);

// Indexes
courseSchema.index({ code: 1 });

const Course = mongoose.model("Course", courseSchema);

export default Course;
