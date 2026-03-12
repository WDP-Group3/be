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
      required: false,
      trim: true,
      default: '',
    },
    googleId: {
      type: String,
      default: null,
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
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
    },

    // --- [MỚI] Khu vực hoạt động (Dành cho Giáo viên) ---
    workingLocation: {
      type: String,
      trim: true,
      default: null,
    },
    // ----------------------------------------------------

    // [MỚI] Thông tin nghỉ phép khẩn cấp (Dành cho Giáo viên)
    emergencyLeaveCount: {
      type: Number,
      default: 0
    },
    lastEmergencyLeaveMonth: {
      type: String, // Format: "2026-03"
      default: null
    },

    // Thông tin hồ sơ cá nhân
    address: {
      type: String,
      trim: true,
      default: '',
    },
    dateOfBirth: {
      type: String,
      default: '',
    },
    gender: {
      type: String,
      enum: ['MALE', 'FEMALE', 'OTHER', ''],
      default: '',
    },
    avatar: {
      type: String, // URL ảnh Cloudinary
      default: null,
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

const User = mongoose.model('User', userSchema);

export default User;