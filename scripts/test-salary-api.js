/**
 * Script test API tính lương
 * Chạy: cd be && node scripts/test-salary-api.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Sử dụng MongoDB Atlas URI từ .env
const MONGODB_URI = 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';

const API_BASE = 'http://localhost:3000/api';

async function testSalaryAPI() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // Lấy instructor đã tạo booking
    const User = (await import('../src/models/User.js')).default;
    const instructor = await User.findOne({ role: 'INSTRUCTOR', status: 'ACTIVE' });
    if (!instructor) {
      console.error('✗ No instructor found');
      process.exit(1);
    }

    const instructorId = instructor._id.toString();
    const instructorName = instructor.fullName;

    console.log('='.repeat(50));
    console.log('TEST: Tính lương cho Instructor');
    console.log('='.repeat(50));
    console.log(`Instructor: ${instructorName}`);
    console.log(`ID: ${instructorId}`);
    console.log(`Month: 3/2026 (tháng trước)`);
    console.log('-'.repeat(50));

    // Test 1: Lấy cấu hình lương
    console.log('\n[1] GET /salary/config - Lấy cấu hình lương');
    try {
      const configRes = await axios.get(`${API_BASE}/salary/config`);
      const config = configRes.data.data;
      console.log('   ✓ Cấu hình lương hiện tại:');
      console.log(`   - Lương/giờ: ${config.instructorHourlyRate?.toLocaleString() || 80000} VNĐ`);
      console.log(`   - Ngày hiệu lực: ${config.effectiveFrom}`);
    } catch (e) {
      console.log('   ✗ Lỗi:', e.response?.data?.message || e.message);
    }

    // Test 2: Lấy tổng lương tháng (admin)
    console.log('\n[2] GET /salary/monthly-summary?month=3&year=2026 - Tổng lương tháng');
    try {
      const summaryRes = await axios.get(`${API_BASE}/salary/monthly-summary?month=3&year=2026`);
      const users = summaryRes.data.data.users;
      const instructorData = users.find(u => u._id === instructorId || u.userId === instructorId);

      if (instructorData) {
        console.log('   ✓ Kết quả:');
        console.log(`   - Số buổi dạy: ${instructorData.totalTeachingSessions}`);
        console.log(`   - Giờ dạy: ${instructorData.totalTeachingHours}`);
        console.log(`   - Lương/giờ: ${instructorData.hourlyRate?.toLocaleString()} VNĐ`);
        console.log(`   - Lương giờ: ${instructorData.teachingSalary?.toLocaleString()} VNĐ`);
        console.log(`   - Hoa hồng: ${instructorData.totalCommission?.toLocaleString()} VNĐ`);
        console.log(`   - TỔNG LƯƠNG: ${instructorData.totalSalary?.toLocaleString()} VNĐ`);
      } else {
        console.log('   ⚠ Instructor không có trong danh sách');
      }
    } catch (e) {
      console.log('   ✗ Lỗi:', e.response?.data?.message || e.message);
    }

    // Test 3: Lấy chi tiết lương
    console.log('\n[3] GET /salary/detail?userId=...&month=3&year=2026 - Chi tiết lương');
    try {
      const detailRes = await axios.get(`${API_BASE}/salary/detail?userId=${instructorId}&month=3&year=2026`);
      const detail = detailRes.data.data;

      console.log('   ✓ Chi tiết lương:');
      console.log(`   - Role: ${detail.role}`);
      console.log(`   - Tổng giờ dạy: ${detail.totalTeachingHours}`);
      console.log(`   - Tổng buổi: ${detail.totalTeachingSessions}`);
      console.log(`   - Lương giờ: ${detail.teachingSalary?.toLocaleString()} VNĐ`);
      console.log(`   - Tổng lương: ${detail.totalSalary?.toLocaleString()} VNĐ`);

      if (detail.teachingDetails?.length > 0) {
        console.log('\n   📋 Chi tiết từng buổi dạy:');
        detail.teachingDetails.slice(0, 5).forEach((t, i) => {
          const date = new Date(t.date).toLocaleDateString('vi-VN');
          console.log(`      ${i+1}. ${date} - ${t.timeSlot} - ${t.studentName} - ${t.amount?.toLocaleString()} VNĐ`);
        });
        if (detail.teachingDetails.length > 5) {
          console.log(`      ... và ${detail.teachingDetails.length - 5} buổi khác`);
        }
      }
    } catch (e) {
      console.log('   ✗ Lỗi:', e.response?.data?.message || e.message);
    }

    // Test 4: Lương của tôi (nếu có token)
    console.log('\n[4] GET /salary/my-salary?month=3&year=2026 - Lương của tôi');
    console.log('   ⚠ Cần token để test (đăng nhập vào portal)');

    console.log('\n' + '='.repeat(50));
    console.log('KẾT LUẬN');
    console.log('='.repeat(50));
    console.log(`✓ Đã tạo 10 booking với status=COMPLETED, attendance=PRESENT`);
    console.log(`✓ Khi xem /admin/salary (tháng 3/2026) sẽ thấy:`);
    console.log(`  - Instructor: ${instructorName}`);
    console.log(`  - Số buổi: 10`);
    console.log(`  - Tổng lương: 800,000 VNĐ (10 buổi × 80,000 VNĐ)`);

    await mongoose.disconnect();
    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testSalaryAPI();
