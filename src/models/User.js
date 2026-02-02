import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    password: {
      type: String,
      required: false,
      trim: true,
    },
    role: {
      type: String,
      enum: ["ADMIN", "STUDENT", "INSTRUCTOR", "CONSULTANT", "GUEST"],
      required: true,
    },
    requestedRole: {
      type: String,
      enum: ["INSTRUCTOR", "CONSULTANT", "STUDENT"],
      default: null,
    },
    approvalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "APPROVED",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: false,
  },
);
mps: (false,
  // Indexes
  userSchema.index({ email: 1 }));
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

const User = mongoose.model("User", userSchema);

export default User;
