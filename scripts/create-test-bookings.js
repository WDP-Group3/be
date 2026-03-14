/**
 * Script tạo 10 booking mẫu để test hệ thống lương
 * Chạy: cd be && node scripts/create-test-bookings.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Import models
const User = (await import('../src/models/User.js')).default;
const Booking = (await import('../src/models/Booking.js')).default;
const Batch = (await import('../src/models/Batch.js')).default;

// Sử dụng MongoDB Atlas URI từ .env
const MONGODB_URI = 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';

const timeSlots = ['Ca 1', 'Ca 2', 'Ca 3', 'Ca 4', 'Ca 5', 'Ca 6', 'Ca 7', 'Ca 8', 'Ca 9', 'Ca 10'];

async function createTestBookings() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    // Lấy instructor
    const instructor = await User.findOne({ role: 'INSTRUCTOR', status: 'ACTIVE' });
    if (!instructor) {
      console.error('✗ No instructor found');
      process.exit(1);
    }
    console.log(`✓ Instructor: ${instructor.fullName} (${instructor._id})`);

    // Lấy danh sách students
    const students = await User.find({ role: 'STUDENT', status: 'ACTIVE' }).limit(10);
    if (students.length < 10) {
      console.error('✗ Not enough students');
      process.exit(1);
    }
    console.log(`✓ Found ${students.length} students`);

    // Lấy batch có _id là ObjectId hợp lệ
    const batch = await Batch.findOne({ _id: { $type: 'objectId' } }).lean();
    if (!batch) {
      console.error('✗ No valid batch found');
      process.exit(1);
    }
    console.log(`✓ Batch: ${batch._id}`);

    // Ngày trong tháng 3/2026 (tháng trước)
    const dates = [
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05',
      '2026-03-06', '2026-03-08', '2026-03-09', '2026-03-10',
      '2026-03-12', '2026-03-13'
    ];

    const bookings = [];
    for (let i = 0; i < 10; i++) {
      const student = students[i];
      const date = new Date(dates[i]);
      const timeSlot = timeSlots[i % 10];

      const booking = {
        studentId: student._id,
        instructorId: instructor._id,
        batchId: batch._id,
        date: date,
        timeSlot: timeSlot,
        type: 'PRACTICE',
        status: 'COMPLETED',
        attendance: 'PRESENT'
      };

      bookings.push(booking);
      console.log(`  ${i + 1}. ${date.toISOString().split('T')[0]} - ${timeSlot} - ${student.fullName}`);
    }

    // Xóa bookings cũ của instructor trong tháng 3/2026 (để tránh trùng)
    const startDate = new Date('2026-03-01');
    const endDate = new Date('2026-03-31');
    const deleted = await Booking.deleteMany({
      instructorId: instructor._id,
      date: { $gte: startDate, $lte: endDate }
    });
    console.log(`\n✓ Deleted ${deleted.deletedCount} existing bookings`);

    // Insert new bookings
    const created = await Booking.insertMany(bookings);
    console.log(`\n✓ Created ${created.length} new bookings`);

    console.log('\n=== TESTING SALARY CALCULATION ===');
    console.log(`Instructor: ${instructor.fullName}`);
    console.log(`Bookings: ${created.length} buổi`);
    console.log(`Hourly rate: 80,000 VNĐ (default)`);
    console.log(`Expected salary: ${created.length * 80000} VNĐ`);

    console.log('\n→ Truy cập /admin/salary để xem kết quả!');

    await mongoose.disconnect();
    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createTestBookings();
