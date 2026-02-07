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
      enum: ["ADMIN", "STUDENT", "INSTRUCTOR", "CONSULTANT"],
      required: true,
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
  }
);

// Indexes (email index is created automatically by unique: true)
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

const User = mongoose.model("User", userSchema);

export default User;

