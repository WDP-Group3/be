import mongoose from 'mongoose';

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
      enum: ['ADMIN', 'STUDENT', 'INSTRUCTOR', 'CONSULTANT'],
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
  },
);

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });

// [QUAN TRỌNG] Index cho workingLocation để chức năng lọc chạy nhanh
userSchema.index({ workingLocation: 1 });

const User = mongoose.model('User', userSchema);

export default User;