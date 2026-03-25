/**
 * Script migrate: Backfill enrolledCourseCodes cho các learner hiện có
 *
 * Chạy: cd be && node src/scripts/migrateEnrolledCourses.js
 *
 * Logic:
 * - Với mỗi learner, tìm tất cả Registration đã thanh toán (firstPaymentDate != null)
 * - Lấy course.code từ mỗi Registration (từ batchId hoặc courseId)
 * - Ghi vào User.enrolledCourseCodes
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../models/User.js';
import Registration from '../models/Registration.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

const migrate = async () => {
  await connectDB();

  // 1. Lấy tất cả learner
  const learners = await User.find({ role: 'learner' });
  console.log(`\n📋 Tìm thấy ${learners.length} learner`);

  let updated = 0;
  let skipped = 0;

  for (const learner of learners) {
    // 2. Tìm tất cả Registration đã thanh toán của learner này
    const regs = await Registration.find({
      learnerId: learner._id,
      firstPaymentDate: { $ne: null },
    }).lean();

    if (regs.length === 0) {
      console.log(`  ⏭️  ${learner.fullName} — không có Registration đã thanh toán`);
      skipped++;
      continue;
    }

    // 3. Trích xuất course codes
    const codes = new Set();
    for (const reg of regs) {
      let courseId = null;

      // Ưu tiên: lấy từ batchId (không populate)
      if (reg.batchId) {
        const batch = await Batch.findById(reg.batchId).lean();
        if (batch?.courseId) {
          courseId = batch.courseId;
        }
      }
      // Fallback: lấy từ courseId trực tiếp
      if (!courseId && reg.courseId) {
        courseId = reg.courseId;
      }

      if (courseId) {
        const course = await Course.findById(courseId).lean();
        if (course?.code) {
          codes.add(course.code);
        }
      }
    }

    const codeArray = [...codes];

    if (codeArray.length === 0) {
      console.log(`  ⏭️  ${learner.fullName} — có Registration nhưng không lấy được course code`);
      skipped++;
      continue;
    }

    // 4. Cập nhật User
    await User.findByIdAndUpdate(learner._id, {
      enrolledCourseCodes: codeArray,
    });

    console.log(`  ✅ ${learner.fullName} (${learner.email})`);
    console.log(`     → enrolledCourseCodes: [${codeArray.join(', ')}]`);
    updated++;
  }

  console.log(`\n📊 Kết quả: ${updated} updated, ${skipped} skipped`);

  // 5. In danh sách User không có enrolledCourseCodes
  const missing = await User.countDocuments({
    role: 'learner',
    $or: [
      { enrolledCourseCodes: { $exists: false } },
      { enrolledCourseCodes: { $size: 0 } },
    ],
  });
  console.log(`⚠️  Learner chưa có hạng đăng ký: ${missing}`);

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected');
};

migrate().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
