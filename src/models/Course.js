import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
      trim: true,
    },
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
      type: String, // Sửa thành String để lưu được "3 tháng" như trong ảnh
    },
    estimatedCost: {
      type: Number, // Tương ứng với price trong controller
    },
    image: {
      type: String, // Thêm trường này vì controller có gửi lên
    },
    location: {
      type: [String],
      default: [],
    },
    note: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
  },
  {
    timestamps: true, // Nên để true
  },
);

// Indexes
courseSchema.index({ code: 1 });
courseSchema.index({ name: "text", code: "text" }); // Index tìm kiếm text

const Course = mongoose.model("Course", courseSchema);

export default Course;
