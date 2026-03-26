/**
 * Script tạo 10 Instructor mẫu để test hệ thống
 * Chạy: cd be && node scripts/create-test-instructors.js
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const MONGODB_URI = 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';

const instructors = [
  { fullName: 'Nguyễn Văn Minh', email: 'instructor01@test.com', phone: '0901000001' },
  { fullName: 'Trần Thị Lan', email: 'instructor02@test.com', phone: '0901000002' },
  { fullName: 'Lê Hoàng Nam', email: 'instructor03@test.com', phone: '0901000003' },
  { fullName: 'Phạm Thu Hà', email: 'instructor04@test.com', phone: '0901000004' },
  { fullName: 'Đặng Quốc Khánh', email: 'instructor05@test.com', phone: '0901000005' },
  { fullName: 'Bùi Thị Mai', email: 'instructor06@test.com', phone: '0901000006' },
  { fullName: 'Hoàng Đức Anh', email: 'instructor07@test.com', phone: '0901000007' },
  { fullName: 'Vũ Thị Ngọc', email: 'instructor08@test.com', phone: '0901000008' },
  { fullName: 'Đỗ Minh Tuấn', email: 'instructor09@test.com', phone: '0901000009' },
  { fullName: 'Ngô Thị Phương', email: 'instructor10@test.com', phone: '0901000010' },
];

async function createTestInstructors() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    const User = (await import('../src/models/User.js')).default;

    // Xóa các instructor test cũ
    const deleted = await User.deleteMany({
      email: { $in: instructors.map(i => i.email) }
    });
    console.log(`✓ Deleted ${deleted.deletedCount} existing test instructors\n`);

    const hashedPassword = await bcrypt.hash('Instructor123!', 10);

    const created = [];
    for (const data of instructors) {
      const instructor = await User.create({
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        password: hashedPassword,
        role: 'INSTRUCTOR',
        status: 'ACTIVE',
      });
      created.push(instructor);
      console.log(`  ✓ ${instructor.fullName} (${instructor.email})`);
    }

    console.log(`\n✓ Created ${created.length} instructors`);
    console.log('\nTài khoản: instructorXX@test.com / Instructor123!');

    await mongoose.disconnect();
    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createTestInstructors();
