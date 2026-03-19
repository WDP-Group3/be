/**
 * Script test lương theo ngày hiệu lực từng khóa học
 * Chạy: cd be && node scripts/test-salary-by-date.js
 *
 * Test case:
 *   - SalaryConfig: course1(A) effective 01/01/2026, course2(B) effective 01/03/2026
 *   - Doc T2 → A → expect 500k
 *   - Doc T3 → A → expect 500k
 *   - Doc T3 → B → expect 600k
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const User = (await import('../src/models/User.js')).default;
const Course = (await import('../src/models/Course.js')).default;
const SalaryConfig = (await import('../src/models/SalaryConfig.js')).default;
const Document = (await import('../src/models/Document.js')).default;
const Registration = (await import('../src/models/Registration.js')).default;
const { getAllConfigs } = await import('../src/controllers/salary.controller.js');

async function createLearnerRegDoc(name, email, phone, course, consultantId, docDate) {
  const learner = await User.create({
    fullName: name,
    email,
    phone,
    role: 'learner',
    status: 'ACTIVE',
  });

  const reg = await Registration.create({
    learnerId: learner._id,
    courseId: course._id,
    registerMethod: 'CONSULTANT',
    status: 'NEW',
  });

  const doc = await Document.create({
    learnerId: learner._id,
    registrationId: reg._id,
    consultantId,
    status: 'PENDING',
    isDeleted: false,
  });

  // Override createdAt để simulate ngày tạo document
  await Document.findByIdAndUpdate(doc._id, { createdAt: docDate });

  return { learner, reg, doc };
}

async function test() {
  await mongoose.connect(MONGODB_URI);
  console.log('✓ Connected to MongoDB\n');

  // ── 1. Lấy Consultant & 2 khóa ───────────────
  const consultant = await User.findOne({ role: 'CONSULTANT', status: 'ACTIVE' });
  if (!consultant) {
    console.error('✗ No CONSULTANT found'); process.exit(1);
  }
  console.log(`✓ Consultant: ${consultant.fullName} (${consultant._id})`);

  const courses = await Course.find({ status: 'Active' }).limit(2);
  if (courses.length < 2) {
    console.error('✗ Need at least 2 active courses'); process.exit(1);
  }
  const [courseA, courseB] = courses;
  console.log(`✓ Course A: ${courseA.code} (${courseA._id})`);
  console.log(`✓ Course B: ${courseB.code} (${courseB._id})\n`);

  // ── 2. Xóa & tạo SalaryConfig test ──────────────────
  await SalaryConfig.deleteMany({});
  const config = await SalaryConfig.create({
    instructorHourlyRate: 80000,
    effectiveFrom: new Date('2026-01-01'),
    courseCommissions: [
      { courseId: courseA._id, commissionAmount: 500000, effectiveFrom: new Date('2026-01-01') },
      { courseId: courseB._id, commissionAmount: 600000, effectiveFrom: new Date('2026-03-01') },
    ],
    note: 'Test salary by date',
  });
  console.log(`✓ Created SalaryConfig: ${config._id}`);
  console.log(`  A (${courseA.code}): 500k từ 01/01/2026`);
  console.log(`  B (${courseB.code}): 600k từ 01/03/2026\n`);

  // ── 3. Tạo 3 test learners/docs ───────────────────
  const testCases = [
    { name: 'HV_T2_A', email: `hv_t2_a_${Date.now()}@test.com`, phone: '0900000001',
      course: courseA, docDate: new Date('2026-02-15'), expect: 500000, label: 'T2 + A → 500k ✓' },
    { name: 'HV_T3_B', email: `hv_t3_b_${Date.now()}@test.com`, phone: '0900000002',
      course: courseB, docDate: new Date('2026-03-20'), expect: 600000, label: 'T3 + B → 600k ✓' },
    { name: 'HV_T3_A', email: `hv_t3_a_${Date.now()}@test.com`, phone: '0900000003',
      course: courseA, docDate: new Date('2026-03-10'), expect: 500000, label: 'T3 + A → 500k ✓' },
  ];

  const created = [];
  for (const tc of testCases) {
    const r = await createLearnerRegDoc(tc.name, tc.email, tc.phone, tc.course, consultant._id, tc.docDate);
    created.push(r);
    console.log(`✓ Created: ${tc.name} | ${tc.docDate.toISOString().split('T')[0]} | ${tc.course.code} | expect ${tc.expect.toLocaleString()}đ`);
  }

  // ── 4. Chạy test từng tháng ─────────────────────
  console.log('\n=== TEST RESULTS ===\n');

  const { getCommissionForCourse } = await import('../src/controllers/salary.controller.js');

  for (const month of [2, 3]) {
    const year = 2026;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const allConfigs = await getAllConfigs();
    const userOverrideMap = {};

    const docs = await Document.find({ consultantId: consultant._id, isDeleted: false })
      .populate({ path: 'registrationId', populate: { path: 'courseId' } })
      .lean();

    const inMonth = docs.filter((doc) => {
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = doc.registrationId?.createdAt ? new Date(doc.registrationId.createdAt) : null;
      const target = docDate || regDate;
      return target && target >= startDate && target <= endDate;
    });

    console.log(`── Tháng ${month}/2026 ──`);
    let total = 0;
    let pass = 0, fail = 0;

    for (const doc of inMonth) {
      const reg = doc.registrationId;
      const courseId = reg?.courseId?._id?.toString() || reg?.courseId?.toString();
      const docDate = doc.createdAt ? new Date(doc.createdAt) : new Date();
      const courseCode = reg?.courseId?.code || 'N/A';

      const { amount } = getCommissionForCourse(courseId, docDate, allConfigs, userOverrideMap);

      // Map với expect
      const tc = created.find(
        (c) => c.doc._id.toString() === doc._id.toString()
      );
      const expected = tc ? tc.doc._doc?.__testExpect || tc.__expect :
        (courseCode === courseA.code ? 500000 : courseCode === courseB.code ? 600000 : 0);

      const ok = amount === expected;
      if (ok) pass++; else fail++;
      console.log(
        `  ${ok ? '✓' : '✗'} ${courseCode} | ${docDate.toISOString().split('T')[0]} | got ${amount.toLocaleString()}đ | expect ${expected.toLocaleString()}đ`
      );
      total += amount;
    }
    console.log(`  → Tổng: ${total.toLocaleString()}đ (pass:${pass} fail:${fail})\n`);
  }

  // ── 5. Cleanup ────────────────────────────────
  console.log('=== CLEANUP ===');
  for (const { learner, reg, doc } of created) {
    await Document.findByIdAndDelete(doc._id);
    await Registration.findByIdAndDelete(reg._id);
    await User.findByIdAndDelete(learner._id);
  }
  await SalaryConfig.findByIdAndDelete(config._id);
  console.log('✓ Cleaned up all test data');

  await mongoose.disconnect();
  console.log('\n✓ Done!');
  process.exit(0);
}

test().catch((err) => {
  console.error('✗ Error:', err.message);
  process.exit(1);
});
