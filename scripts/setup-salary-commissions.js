/**
 * Setup Salary Commissions for all courses
 * Run: cd be && node scripts/setup-salary-commissions.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';
const API_BASE = 'http://localhost:3000/api';

const Course = (await import('../src/models/Course.js')).default;
const SalaryConfig = (await import('../src/models/SalaryConfig.js')).default;

await mongoose.connect(MONGODB_URI);
console.log('✅ Connected to MongoDB\n');

// ── 1. Lấy tất cả courses ─────────────────────────────
const courses = await Course.find().lean();
console.log('Khóa học trong hệ thống:');
courses.forEach(c => console.log(`  - ${c.code}: ${c.name} (${c._id})`));
console.log();

// ── 2. Lấy admin token ────────────────────────────────
const loginRes = await axios.post(`${API_BASE}/auth/login`, {
  email: 'admin@drivecenter.com',
  password: 'Admin123!@#'
});
const token = loginRes.data.token;
console.log('✅ Admin logged in\n');

// ── 3. Xóa cấu hình cũ ────────────────────────────────
await SalaryConfig.deleteMany({});
console.log('🗑 Đã xóa cấu hình cũ\n');

// ── 4. Tạo cấu hình mới ──────────────────────────────
const commissions = [
  { courseCode: 'A1',     amount: 300000,  label: '300,000 VND' },
  { courseCode: 'A2',    amount: 400000,  label: '400,000 VND' },
  { courseCode: 'B Tự Động (B1)', amount: 500000, label: '500,000 VND' },
  { courseCode: 'B Số Sàn (B2)', amount: 500000,  label: '500,000 VND' },
];

const courseCommissions = courses.map(course => {
  const match = commissions.find(c => course.code.includes(c.courseCode));
  return {
    courseId: course._id,
    commissionAmount: match ? match.amount : 400000,
    effectiveFrom: new Date('2026-01-01')
  };
});

const configData = {
  instructorHourlyRate: 80000,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  note: 'Cấu hình lương chính thức từ 01/01/2026',
  courseCommissions
};

const configRes = await axios.post(`${API_BASE}/salary/config`, configData, {
  headers: { Authorization: `Bearer ${token}` }
});

console.log('✅ Đã tạo cấu hình lương mới:');
console.log(`   - Lương giờ Instructor: 80,000 VND`);
console.log(`   - Ngày hiệu lực: 01/01/2026`);
console.log(`   - Hoa hồng theo khóa:`);

for (const cc of configData.courseCommissions) {
  const course = courses.find(c => c._id.toString() === cc.courseId.toString());
  const match = commissions.find(c => course.code.includes(c.courseCode));
  console.log(`      ${course.code}: ${match ? match.label : '400,000 VND'}`);
}

console.log();
console.log('✅ Setup hoàn tất!');
console.log('\nBây giờ khi vào /admin/salary:');
console.log('  - Instructor sẽ nhận lương theo giờ');
console.log('  - Consultant sẽ nhận hoa hồng khi có hồ sơ đăng ký');

await mongoose.disconnect();
