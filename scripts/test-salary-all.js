/**
 * Comprehensive Salary System Test
 * Run: cd be && node scripts/test-salary-all.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';
const API_BASE = 'http://localhost:3000/api';

let adminToken = '';
let instructorToken = '';
let consultantToken = '';

let instructorId = '';
let consultantId = '';
let instructorName = '';
let consultantName = '';

const User = (await import('../src/models/User.js')).default;
const SalaryConfig = (await import('../src/models/SalaryConfig.js')).default;
const SalaryReport = (await import('../src/models/SalaryReport.js')).default;
const Course = (await import('../src/models/Course.js')).default;
const Booking = (await import('../src/models/Booking.js')).default;
const Document = (await import('../src/models/Document.js')).default;
const Registration = (await import('../src/models/Registration.js')).default;

const PASS = '✅';
const FAIL = '❌';

async function login(email, password) {
  const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
  return res.data.token;
}

async function apiGet(path, token) {
  return axios.get(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function apiPost(path, data, token) {
  return axios.post(`${API_BASE}${path}`, data, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function apiPut(path, data, token) {
  return axios.put(`${API_BASE}${path}`, data, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

// ============================================================
// TEST SUITE
// ============================================================

async function runTests() {
  const results = [];
  const log = (msg) => { console.log(msg); results.push(msg); };

  try {
    // ── 0. Connect DB ─────────────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 0: Kết nối Database');
    log('═══════════════════════════════════════════════════════');
    await mongoose.connect(MONGODB_URI);
    log(`${PASS} Connected to MongoDB`);

    // ── 1. Find test users ──────────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 1: Tìm Users để test');
    log('═══════════════════════════════════════════════════════');

    const instructor = await User.findOne({ role: 'INSTRUCTOR', status: 'ACTIVE' });
    const consultant = await User.findOne({ role: 'CONSULTANT', status: 'ACTIVE' });
    const admin = await User.findOne({ role: 'ADMIN', status: 'ACTIVE' });

    if (!instructor) { log(`${FAIL} Không tìm thấy INSTRUCTOR nào`); process.exit(1); }
    if (!consultant) { log(`${FAIL} Không tìm thấy CONSULTANT nào`); process.exit(1); }
    if (!admin) { log(`${FAIL} Không tìm thấy ADMIN nào`); process.exit(1); }

    instructorId = instructor._id.toString();
    instructorName = instructor.fullName;
    consultantId = consultant._id.toString();
    consultantName = consultant.fullName;

    log(`${PASS} Instructor: ${instructorName} (${instructorId})`);
    log(`${PASS} Consultant: ${consultantName} (${consultantId})`);
    log(`${PASS} Admin: ${admin.fullName} (${admin._id})`);

    // ── 2. Login ────────────────────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 2: Login để lấy token');
    log('═══════════════════════════════════════════════════════');

    try {
      // Direct login with known credentials
      const res = await axios.post(`${API_BASE}/auth/login`, { email: 'admin@drivecenter.com', password: 'Admin123!@#' });
      adminToken = res.data.token;
      log(`${PASS} Admin login OK (token: ${adminToken.slice(0, 20)}...)`);
    } catch (e) {
      log(`${FAIL} Admin login failed: ${e.response?.data?.message || e.message}`);
    }

    // ── 3. Test GET /salary/config (Admin) ──────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 3: Test GET /salary/config');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet('/salary/config', adminToken);
      const config = res.data.data;
      log(`${PASS} Lấy cấu hình lương thành công`);
      log(`   - instructorHourlyRate: ${config.instructorHourlyRate?.toLocaleString() || 'default 80000'} VND`);
      log(`   - Số course commissions: ${config.courseCommissions?.length || 0}`);
      log(`   - isNew: ${config.isNew}`);
    } catch (e) {
      log(`${FAIL} GET /salary/config: ${e.response?.data?.message || e.message}`);
    }

    // ── 4. Test POST /salary/config (Create) ───────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 4: Test POST /salary/config (Tạo cấu hình)');
    log('═══════════════════════════════════════════════════════');

    const courses = await Course.find().lean();
    log(`   Tìm thấy ${courses.length} khóa học active`);

    const testConfigData = {
      instructorHourlyRate: 90000,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      note: 'Test config',
      courseCommissions: courses.map(c => ({
        courseId: c._id,
        commissionAmount: 500000,
        effectiveFrom: '2026-01-01'
      }))
    };

    let createdConfigId = '';
    try {
      const res = await apiPost('/salary/config', testConfigData, adminToken);
      createdConfigId = res.data.data._id;
      log(`${PASS} Tạo cấu hình lương thành công (ID: ${createdConfigId})`);
    } catch (e) {
      log(`${FAIL} POST /salary/config: ${e.response?.data?.message || e.message}`);
    }

    // ── 5. Test GET /salary/configs (List all) ──────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 5: Test GET /salary/configs');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet('/salary/configs', adminToken);
      const configs = res.data.data;
      log(`${PASS} Lấy danh sách cấu hình: ${configs.length} cấu hình`);
      configs.forEach(c => {
        log(`   - ID: ${c._id} | Rate: ${c.instructorHourlyRate?.toLocaleString()} VND | Từ: ${new Date(c.effectiveFrom).toLocaleDateString('vi-VN')}`);
      });
    } catch (e) {
      log(`${FAIL} GET /salary/configs: ${e.response?.data?.message || e.message}`);
    }

    // ── 6. Test PUT /salary/config/:id (Update) ─────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 6: Test PUT /salary/config/:id');
    log('═══════════════════════════════════════════════════════');

    if (createdConfigId) {
      try {
        const res = await apiPut(`/salary/config/${createdConfigId}`, { instructorHourlyRate: 95000 }, adminToken);
        log(`${PASS} Cập nhật cấu hình lương thành công (rate: 95000 VND)`);
      } catch (e) {
        log(`${FAIL} PUT /salary/config: ${e.response?.data?.message || e.message}`);
      }
    } else {
      log('⚠ Bỏ qua (chưa có config ID)');
    }

    // ── 7. Test GET /salary/courses ─────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 7: Test GET /salary/courses');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet('/salary/courses', adminToken);
      const salaryCourses = res.data.data;
      log(`${PASS} Lấy danh sách khóa học: ${salaryCourses.length} khóa`);
      salaryCourses.forEach(c => log(`   - ${c.code}: ${c.name}`));
    } catch (e) {
      log(`${FAIL} GET /salary/courses: ${e.response?.data?.message || e.message}`);
    }

    // ── 8. Test GET /salary/monthly-summary ────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 8: Test GET /salary/monthly-summary (Admin)');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet('/salary/monthly-summary?month=3&year=2026', adminToken);
      const summary = res.data.data;
      log(`${PASS} Lấy tổng lương tháng 3/2026`);
      log(`   - Tổng users: ${summary.users?.length || 0}`);
      log(`   - Pagination: page ${summary.pagination?.page}/${summary.pagination?.pages} (${summary.pagination?.total} total)`);

      // Tìm instructor trong danh sách
      const instrData = summary.users?.find(u => u._id === instructorId || u._id?.toString() === instructorId);
      if (instrData) {
        log(`\n   📋 Instructor: ${instrData.fullName}`);
        log(`      - Role: ${instrData.role}`);
        log(`      - Buổi dạy: ${instrData.totalTeachingSessions}`);
        log(`      - Giờ dạy: ${instrData.totalTeachingHours}`);
        log(`      - Lương/giờ: ${instrData.hourlyRate?.toLocaleString()} VND`);
        log(`      - Lương giờ: ${instrData.teachingSalary?.toLocaleString()} VND`);
        log(`      - Hoa hồng: ${instrData.totalCommission?.toLocaleString() || 0} VND`);
        log(`      - TỔNG LƯƠNG: ${instrData.totalSalary?.toLocaleString()} VND`);
      }

      const consData = summary.users?.find(u => u._id === consultantId || u._id?.toString() === consultantId);
      if (consData) {
        log(`\n   📋 Consultant: ${consData.fullName}`);
        log(`      - Role: ${consData.role}`);
        log(`      - Số hồ sơ: ${consData.totalDocuments || 0}`);
        log(`      - Hoa hồng: ${consData.totalCommission?.toLocaleString() || 0} VND`);
        log(`      - TỔNG LƯƠNG: ${consData.totalSalary?.toLocaleString()} VND`);
      }
    } catch (e) {
      log(`${FAIL} GET /salary/monthly-summary: ${e.response?.data?.message || e.message}`);
    }

    // ── 9. Test GET /salary/detail ──────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 9: Test GET /salary/detail (Admin)');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet(`/salary/detail?userId=${instructorId}&month=3&year=2026`, adminToken);
      const detail = res.data.data;
      log(`${PASS} Lấy chi tiết lương instructor`);
      log(`   - Role: ${detail.role}`);
      log(`   - Giờ dạy: ${detail.totalTeachingHours}`);
      log(`   - Buổi dạy: ${detail.totalTeachingSessions}`);
      log(`   - Lương giờ: ${detail.teachingSalary?.toLocaleString()} VND`);
      log(`   - Tổng lương: ${detail.totalSalary?.toLocaleString()} VND`);

      if (detail.teachingDetails?.length > 0) {
        log(`   - Chi tiết buổi dạy (${detail.teachingDetails.length} buổi):`);
        detail.teachingDetails.slice(0, 3).forEach((t, i) => {
          const date = new Date(t.date).toLocaleDateString('vi-VN');
          log(`      ${i+1}. ${date} | ${t.timeSlot} | ${t.learnerName} | ${t.amount?.toLocaleString()} VND`);
        });
        if (detail.teachingDetails.length > 3) {
          log(`      ... và ${detail.teachingDetails.length - 3} buổi khác`);
        }
      }
    } catch (e) {
      log(`${FAIL} GET /salary/detail: ${e.response?.data?.message || e.message}`);
    }

    // ── 10. Test consultant detail ──────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 10: Test GET /salary/detail (Consultant)');
    log('═══════════════════════════════════════════════════════');

    try {
      const res = await apiGet(`/salary/detail?userId=${consultantId}&month=3&year=2026`, adminToken);
      const detail = res.data.data;
      log(`${PASS} Lấy chi tiết lương consultant`);
      log(`   - Role: ${detail.role}`);
      log(`   - Số hồ sơ: ${detail.totalDocuments}`);
      log(`   - Tổng hoa hồng: ${detail.totalCommission?.toLocaleString() || 0} VND`);
      log(`   - Tổng lương: ${detail.totalSalary?.toLocaleString() || 0} VND`);

      if (detail.commissionDetails?.length > 0) {
        log(`   - Chi tiết hoa hồng (${detail.commissionDetails.length} hồ sơ):`);
        detail.commissionDetails.slice(0, 3).forEach((d, i) => {
          const date = new Date(d.registrationDate).toLocaleDateString('vi-VN');
          log(`      ${i+1}. ${d.courseCode} | ${d.learnerName} | ${date} | ${d.commissionAmount?.toLocaleString()} VND`);
        });
        if (detail.commissionDetails.length > 3) {
          log(`      ... và ${detail.commissionDetails.length - 3} hồ sơ khác`);
        }
      }
    } catch (e) {
      log(`${FAIL} GET /salary/detail (Consultant): ${e.response?.data?.message || e.message}`);
    }

    // ── 11. Test User Override ───────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 11: Test User Salary Override');
    log('═══════════════════════════════════════════════════════');

    try {
      // GET override
      const getRes = await apiGet(`/salary/users/${instructorId}/override`, adminToken);
      log(`${PASS} GET override - salaryHourlyRate: ${getRes.data.data.salaryHourlyRate || 'null (dùng config)'}`);

      // PUT override
      const putRes = await apiPut(`/salary/users/${instructorId}/override`, { salaryHourlyRate: 100000 }, adminToken);
      log(`${PASS} PUT override - Đặt salaryHourlyRate = 100,000 VND`);

      // GET again to verify
      const verifyRes = await apiGet(`/salary/users/${instructorId}/override`, adminToken);
      const newRate = verifyRes.data.data.salaryHourlyRate;
      log(`   - Xác nhận: salaryHourlyRate = ${newRate?.toLocaleString() || 'null'} VND`);

      // Reset về null
      await apiPut(`/salary/users/${instructorId}/override`, { salaryHourlyRate: null }, adminToken);
      log(`${PASS} Reset override về null`);
    } catch (e) {
      log(`${FAIL} User override: ${e.response?.data?.message || e.message}`);
    }

    // ── 12. Test Pagination & Filters ──────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 12: Test Phân trang & Bộ lọc');
    log('═══════════════════════════════════════════════════════');

    try {
      const res1 = await apiGet('/salary/monthly-summary?month=3&year=2026&role=INSTRUCTOR', adminToken);
      log(`${PASS} Filter INSTRUCTOR: ${res1.data.data.users?.length || 0} users`);

      const res2 = await apiGet('/salary/monthly-summary?month=3&year=2026&role=CONSULTANT', adminToken);
      log(`${PASS} Filter CONSULTANT: ${res2.data.data.users?.length || 0} users`);

      const res3 = await apiGet('/salary/monthly-summary?month=3&year=2026&page=1&limit=2', adminToken);
      log(`${PASS} Pagination (page=1, limit=2): ${res3.data.data.users?.length || 0} users, ${res3.data.data.pagination?.pages} trang`);

      const res4 = await apiGet('/salary/monthly-summary?month=3&year=2026&search=Quan', adminToken);
      log(`${PASS} Search "Quan": ${res4.data.data.users?.length || 0} users`);
    } catch (e) {
      log(`${FAIL} Pagination/filters: ${e.response?.data?.message || e.message}`);
    }

    // ── 13. Test Auth Requirements ──────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 13: Test Yêu cầu xác thực (Auth)');
    log('═══════════════════════════════════════════════════════');

    const authTests = [
      { path: '/salary/config', method: 'GET', token: false, desc: 'GET /salary/config không token' },
      { path: '/salary/configs', method: 'GET', token: false, desc: 'GET /salary/configs không token' },
      { path: '/salary/monthly-summary', method: 'GET', token: false, desc: 'GET /salary/monthly-summary không token' },
    ];

    for (const t of authTests) {
      try {
        const res = await axios.get(`${API_BASE}${t.path}`);
        log(`⚠ ${t.desc}: Unexpected OK (${res.status})`);
      } catch (e) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          log(`${PASS} ${t.desc}: Đúng bị từ chối (${e.response.status})`);
        } else {
          log(`⚠ ${t.desc}: Lỗi khác - ${e.response?.status || e.message}`);
        }
      }
    }

    // ── 14. Test Salary Report creation ────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 14: Test SalaryReport auto-created');
    log('═══════════════════════════════════════════════════════');

    try {
      const report = await SalaryReport.findOne({ userId: instructorId, month: 3, year: 2026 }).lean();
      if (report) {
        log(`${PASS} SalaryReport đã được tạo tự động`);
        log(`   - Status: ${report.status}`);
        log(`   - Tổng lương: ${report.totalSalary?.toLocaleString() || 0} VND`);
        log(`   - Teaching sessions: ${report.totalTeachingSessions}`);
      } else {
        log(`⚠ SalaryReport chưa có cho instructor tháng 3/2026`);
      }

      const reportC = await SalaryReport.findOne({ userId: consultantId, month: 3, year: 2026 }).lean();
      if (reportC) {
        log(`${PASS} SalaryReport cho consultant đã được tạo`);
        log(`   - Tổng lương: ${reportC.totalSalary?.toLocaleString() || 0} VND`);
      }
    } catch (e) {
      log(`${FAIL} SalaryReport check: ${e.message}`);
    }

    // ── 15. Test Business Logic ─────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('BƯỚC 15: Test Business Logic (Tính lương)');
    log('═══════════════════════════════════════════════════════');

    // Instructor: đếm booking COMPLETED + PRESENT trong tháng
    try {
      const startDate = new Date(2026, 2, 1);
      const endDate = new Date(2026, 3, 0, 23, 59, 59);

      const bookings = await Booking.find({
        instructorId,
        date: { $gte: startDate, $lte: endDate },
        attendance: 'PRESENT',
        status: 'COMPLETED'
      }).lean();

      log(`   - Booking COMPLETED + PRESENT tháng 3/2026: ${bookings.length} buổi`);
      if (bookings.length > 0) {
        log(`   - Tổng lương instructor (config rate): ${bookings.length} × 95,000 = ${(bookings.length * 95000).toLocaleString()} VND`);
        log(`   - Tổng lương instructor (default rate): ${bookings.length} × 80,000 = ${(bookings.length * 80000).toLocaleString()} VND`);
      }

      bookings.forEach(b => {
        const date = new Date(b.date).toLocaleDateString('vi-VN');
        log(`      - ${date} | Ca ${b.timeSlot} | Attendance: ${b.attendance} | Status: ${b.status}`);
      });
    } catch (e) {
      log(`${FAIL} Business logic check: ${e.message}`);
    }

    // Consultant: đếm document trong tháng
    try {
      const docs = await Document.find({
        consultantId,
        isDeleted: false
      }).populate({ path: 'registrationId', populate: { path: 'courseId' } }).lean();

      const docsInMonth = docs.filter(d => {
        const docDate = d.createdAt ? new Date(d.createdAt) : null;
        const startDate = new Date(2026, 2, 1);
        const endDate = new Date(2026, 3, 0, 23, 59, 59);
        return docDate && docDate >= startDate && docDate <= endDate;
      });

      log(`   - Document của consultant tháng 3/2026: ${docsInMonth.length} hồ sơ`);
      if (docsInMonth.length > 0) {
        const totalCommission = docsInMonth.length * 500000;
        log(`   - Tổng hoa hồng (config rate): ${docsInMonth.length} × 500,000 = ${totalCommission.toLocaleString()} VND`);
      }
    } catch (e) {
      log(`${FAIL} Commission check: ${e.message}`);
    }

    // ── 16. Summary ────────────────────────────────────────
    log('\n═══════════════════════════════════════════════════════');
    log('TỔNG KẾT');
    log('═══════════════════════════════════════════════════════');

    const passed = results.filter(r => r.includes(PASS)).length;
    const failed = results.filter(r => r.includes(FAIL)).length;
    const warnings = results.filter(r => r.includes('⚠')).length;

    log(`\n${PASS} Passed: ${passed}`);
    if (failed > 0) log(`${FAIL} Failed: ${failed}`);
    if (warnings > 0) log(`⚠ Warnings: ${warnings}`);
    log('\n');

    // Cleanup: xóa config test
    if (createdConfigId) {
      await SalaryConfig.findByIdAndDelete(createdConfigId);
      log(`🧹 Đã xóa config test: ${createdConfigId}`);
    }

    await mongoose.disconnect();
    log('\n✓ Test hoàn tất!');
    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('❌ Lỗi toàn cục:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

runTests();
