import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';

import User from '../models/User.js';
import Registration from '../models/Registration.js';
import Transaction from '../models/Transaction.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';

dotenv.config();

const generatePhone = (index) => {
  const prefixes = ['090', '091', '092', '093', '094', '095', '096', '097', '098', '099'];
  const prefix = prefixes[index % prefixes.length];
  const number = String(1000000 + index).slice(-6);
  return prefix + number;
};

const generateEmail = (courseIndex, LEARNERIndex) => {
  return `LEARNER_c${courseIndex}_${LEARNERIndex}@example.com`;
};

const generateName = (index) => {
  const firstNames = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ'];
  const middleNames = ['Văn', 'Thị', 'Minh', 'Hữu', 'Quang', 'Thanh', 'Anh', 'Ngọc', 'Phương', 'Lin'];
  const lastNames = ['Hùng', 'Anh', 'Nam', 'Thảo', 'Linh', 'Hoa', 'Dũng', 'Hà', 'Mai', 'Oanh'];

  const firstName = firstNames[index % firstNames.length];
  const middleName = middleNames[(index + 3) % middleNames.length];
  const lastName = lastNames[(index + 7) % lastNames.length];

  return `${firstName} ${middleName} ${lastName}`;
};

// Sinh số tiền thanh toán ngẫu nhiên với mức hợp lý
const generateRandomPayment = (courseCost) => {
  const minPayment = courseCost * 0.2; // Tối thiểu 20%
  const maxPayment = courseCost * 0.5;  // Tối đa 50%
  // Sinh số tiền chia hết cho 10000
  const randomAmount = Math.floor(Math.random() * ((maxPayment - minPayment) / 10000 + 1)) * 10000 + minPayment;
  return Math.round(randomAmount / 1000) * 1000; // Làm tròn đến nghìn
};

const createLEARNERs = async () => {
  try {
    await connectDB();

    // Lấy 4 khóa học đầu tiên
    const courses = await Course.find({}).limit(4);
    if (courses.length < 4) {
      console.log('❌ Cần ít nhất 4 khóa học Active trong database!');
      console.log(`   Hiện có: ${courses.length} khóa học`);
      await mongoose.connection.close();
      process.exit(1);
    }
    console.log(`✅ Tìm thấy ${courses.length} khóa học:`);
    courses.forEach((c, i) => console.log(`   ${i + 1}. ${c.name} (${c.code}) - Học phí: ${c.estimatedCost?.toLocaleString()} VNĐ`));

    // Lấy các batch của từng khóa học
    const courseBatches = {};
    for (const course of courses) {
      const batches = await Batch.find({ courseId: course._id, status: 'OPEN' }).limit(1);
      courseBatches[course._id.toString()] = batches[0]?._id || null;
    }

    console.log('\n📝 Bắt đầu tạo 15 học viên cho mỗi khóa học...\n');

    let totalLEARNERs = 0;
    let totalRegistrations = 0;
    let totalTransactions = 0;

    // Mỗi khóa học có 15 học viên
    for (let courseIndex = 0; courseIndex < courses.length; courseIndex++) {
      const course = courses[courseIndex];
      const courseCost = course.estimatedCost || 10000000;
      const batchId = courseBatches[course._id.toString()] || null; // Có thể null để được auto-enroll

      console.log(`\n📚 Khóa học: ${course.name}`);
      console.log('-----------------------------------');

      for (let LEARNERIndex = 1; LEARNERIndex <= 15; LEARNERIndex++) {
        const globalIndex = courseIndex * 15 + LEARNERIndex;

        // Tạo user học viên
        const LEARNER = new User({
          fullName: generateName(globalIndex),
          phone: generatePhone(globalIndex),
          email: generateEmail(courseIndex + 1, LEARNERIndex),
          password: '$2a$10$dummy',
          role: 'LEARNER',
          status: 'ACTIVE',
          address: `Địa chỉ ${globalIndex}`,
          dateOfBirth: '2000-01-01',
          gender: globalIndex % 2 === 0 ? 'MALE' : 'FEMALE',
        });
        await LEARNER.save();
        totalLEARNERs++;

        // Tạo registration cho khóa học này
        // Status NEW để có thể được tự động gán vào lớp khi tạo batch
        const registration = new Registration({
          LEARNERId: LEARNER._id,
          courseId: course._id,
          batchId: batchId, // Có thể null nếu chưa có lớp
          registerMethod: LEARNERIndex % 3 === 0 ? 'ONLINE' : 'CONSULTANT',
          status: 'NEW', // Đổi từ STUDYING sang NEW để được auto-enroll
          paymentPlanType: LEARNERIndex % 2 === 0 ? 'FULL' : 'INSTALLMENT',
          feePlanSnapshot: course.feePayments || [],
        });
        await registration.save();
        totalRegistrations++;

        // Tạo transaction thanh toán lần 1 với số tiền khác nhau
        const paymentAmount = generateRandomPayment(courseCost);

        const transaction = new Transaction({
          amount: paymentAmount,
          orderInfo: `Thanh toán lần 1 - ${course.name}`,
          transferContent: `C${courseIndex + 1}_ST${LEARNERIndex}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          registrationId: registration._id,
          user: LEARNER._id,
          paymentMethod: 'SEPAY',
          status: 'completed',
          paidAt: new Date(),
        });
        await transaction.save();
        totalTransactions++;

        console.log(`   ✅ ${LEARNER.fullName} - ${LEARNER.email}`);
        console.log(`      📱 ${LEARNER.phone} | 💰 ${paymentAmount.toLocaleString()} VNĐ`);
      }
    }

    console.log('\n========================================');
    console.log('✅ Hoàn thành!');
    console.log(`   📚 Tổng khóa học: 4`);
    console.log(`   👥 Tổng học viên: ${totalLEARNERs} (15/khóa)`);
    console.log(`   📝 Tổng đăng ký: ${totalRegistrations}`);
    console.log(`   💰 Tổng giao dịch: ${totalTransactions}`);
    console.log('========================================\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi tạo dữ liệu:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

createLEARNERs();
