/**
 * Script tạo documents mẫu để test hệ thống lương Consultant
 * Chạy: cd be && node scripts/create-test-documents.js
 */

import mongoose from 'mongoose';

// Sử dụng MongoDB Atlas URI từ .env
const MONGODB_URI = 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';

async function createTestDocuments() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    const User = (await import('../src/models/User.js')).default;
    const Document = (await import('../src/models/Document.js')).default;
    const Registration = (await import('../src/models/Registration.js')).default;
    const Course = (await import('../src/models/Course.js')).default;

    // Lấy consultant
    const consultant = await User.findOne({ role: 'CONSULTANT', status: 'ACTIVE' });
    if (!consultant) {
      console.error('✗ No consultant found');
      process.exit(1);
    }
    console.log(`✓ Consultant: ${consultant.fullName} (${consultant._id})`);

    // Lấy course
    const course = await Course.findOne();
    if (!course) {
      console.error('✗ No course found');
      process.exit(1);
    }
    console.log(`✓ Course: ${course.name} (${course._id})`);

    // Lấy student
    const student = await User.findOne({ role: 'STUDENT', status: 'ACTIVE' });
    if (!student) {
      console.error('✗ No student found');
      process.exit(1);
    }
    console.log(`✓ Student: ${student.fullName} (${student._id})`);

    // Tạo registrations và documents
    const dates = [
      '2026-02-10', '2026-02-15', '2026-02-20',
      '2026-03-01', '2026-03-05', '2026-03-10'
    ];

    // Xóa documents cũ của consultant
    const deleted = await Document.deleteMany({ consultantId: consultant._id });
    console.log(`\n✓ Deleted ${deleted.deletedCount} existing documents`);

    const documents = [];
    for (let i = 0; i < dates.length; i++) {
      const date = new Date(dates[i]);

      // Tạo registration
      const registration = await Registration.create({
        studentId: student._id,
        courseId: course._id,
        status: 'STUDYING',
        paymentStatus: 'PAID',
        registerMethod: 'CONSULTANT'
      });

      // Tạo document
      const doc = await Document.create({
        studentId: student._id,
        consultantId: consultant._id,
        registrationId: registration._id,
        type: 'CCCD',
        status: 'APPROVED',
        createdAt: date
      });

      documents.push(doc);
      console.log(`  ${i + 1}. ${dates[i]} - ${student.fullName} - ${course.code}`);
    }

    console.log(`\n✓ Created ${documents.length} documents`);

    // Thống kê
    console.log('\n=== THỐNG KÊ ===');
    console.log(`Tháng 2/2026: ${dates.filter(d => d.startsWith('2026-02')).length} hồ sơ`);
    console.log(`Tháng 3/2026: ${dates.filter(d => d.startsWith('2026-03')).length} hồ sơ`);

    console.log('\n→ Vào /portal/salary để xem lương!');

    await mongoose.disconnect();
    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createTestDocuments();
