import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';

dotenv.config();

const createAdmin = async () => {
  try {
    await connectDB();

    const adminEmail = 'admin@drivecenter.com';
    const adminPassword = 'Admin123!@#';

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('✅ Admin đã tồn tại:');
      console.log(`   Email: ${adminEmail}`);
      console.log(`   Password: ${adminPassword}`);
      console.log(`   Role: ${existingAdmin.role}`);
      await mongoose.connection.close();
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    const admin = new User({
      fullName: 'Administrator',
      email: adminEmail,
      phone: '0900000000',
      password: hashedPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    await admin.save();

    console.log('✅ Đã tạo tài khoản Admin thành công!');
    console.log('📧 Email:', adminEmail);
    console.log('🔑 Password:', adminPassword);
    console.log('⚠️  Lưu ý: Vui lòng đổi mật khẩu sau khi đăng nhập!');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi tạo admin:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

createAdmin();
