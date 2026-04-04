import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import SalaryConfig from '../models/SalaryConfig.js';
import SalaryReport from '../models/SalaryReport.js';
import LeaveConfig from '../models/LeaveConfig.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Document from '../models/Document.js';
import Penalty from '../models/Penalty.js';
import Registration from '../models/Registration.js';
import Batch from '../models/Batch.js';

// Helpers được export thẳng từ controller để test
// (Cần export chúng trước)
import {
  getActiveConfig,
  getConfigForMonth,
  getAllConfigs,
  getCommissionForCourse,
  getLeaveConfigForYear,
  getMySalary,
  getMonthlySummary,
} from '../controllers/salary.controller.js';

// ============================================================
// FIXTURES
// ============================================================

let mongoServer;
let instructorId;
let consultantId;
let courseA1Id;
let courseB1Id;
let salaryConfigId;
let adminUserId;
let instructorUserId;
let consultantUserId;

const FIXTURE_YEAR = 2026;
const FIXTURE_MONTH = 4; // April 2026

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  vi.resetModules();

  // Tạo users
  const instructor = await User.create({
    fullName: 'GV Test',
    email: 'gv@test.com',
    phone: '0900000001',
    role: 'INSTRUCTOR',
    status: 'ACTIVE',
  });
  instructorId = instructor._id;

  const consultant = await User.create({
    fullName: 'TV Test',
    email: 'tv@test.com',
    phone: '0900000002',
    role: 'CONSULTANT',
    status: 'ACTIVE',
  });
  consultantId = consultant._id;

  const admin = await User.create({
    fullName: 'Admin Test',
    email: 'admin@test.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  });
  adminUserId = admin._id;

  // Tạo khóa học
  const courseA1 = await Course.create({ name: 'A1', code: 'A1', status: 'Active' });
  courseA1Id = courseA1._id;

  const courseB1 = await Course.create({ name: 'B1', code: 'B1', status: 'Active' });
  courseB1Id = courseB1._id;

  // Tạo SalaryConfig effective từ ngày 1/4/2026
  const config = await SalaryConfig.create({
    instructorHourlyRate: 80000,
    effectiveFrom: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 1),
    courseCommissions: [
      { courseId: courseA1Id, commissionAmount: 10000, effectiveFrom: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 1) },
      { courseId: courseB1Id, commissionAmount: 50000, effectiveFrom: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 1) },
    ],
  });
  salaryConfigId = config._id;

  // Tạo Batch
  const batch = await Batch.create({
    courseId: courseA1Id,
    startDate: new Date(FIXTURE_YEAR - 1, 0, 1),
    status: 'OPEN',
    maxlearners: 50,
  });

  // Tạo Learner
  const learner = await User.create({
    fullName: 'Learner Test',
    email: 'learner@test.com',
    phone: '0900000099',
    role: 'learner',
    status: 'ACTIVE',
  });

  // Tạo Registration + Document cho Consultant
  const reg = await Registration.create({
    learnerId: learner._id,
    courseId: courseA1Id,
    batchId: batch._id,
    registerMethod: 'ONLINE',
    status: 'STUDYING',
    firstPaymentDate: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 10),
  });

  await Document.create({
    consultantId: consultantId,
    registrationId: reg._id,
    cccdNumber: '123456789',
    isDeleted: false,
    createdAt: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 10),
  });

  // Tạo Booking cho Instructor (1 buổi dạy)
  await Booking.create({
    instructorId: instructorId,
    learnerId: learner._id,
    batchId: batch._id,
    date: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 15),
    timeSlot: 1,
    attendance: 'PRESENT',
    status: 'COMPLETED',
    attendanceReminderSent: true,
  });

  // Tạo Penalty 8.567.000 cho tất cả user trong tháng
  await Penalty.create({
    user: instructorId,
    amount: 8567000,
    reason: 'Test penalty',
    date: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 20),
  });

  await Penalty.create({
    user: consultantId,
    amount: 8567000,
    reason: 'Test penalty',
    date: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 20),
  });

  // Tạo LeaveConfig
  await LeaveConfig.create({
    year: FIXTURE_YEAR,
    paidLeaveDaysPerYear: 12,
    leaveDeductionPerDay: 0,
  });
});

// ============================================================
// TEST: Helper functions
// ============================================================

describe('getActiveConfig', () => {
  it('should return the active salary config', async () => {
    const config = await getActiveConfig();
    expect(config).toBeTruthy();
    expect(config.instructorHourlyRate).toBe(80000);
  });

  it('should return null when no config exists', async () => {
    await SalaryConfig.deleteMany({});
    const config = await getActiveConfig();
    expect(config).toBeNull();
  });
});

describe('getConfigForMonth', () => {
  it('should return config for the target month', async () => {
    const config = await getConfigForMonth(FIXTURE_YEAR, FIXTURE_MONTH);
    expect(config).toBeTruthy();
    expect(config.instructorHourlyRate).toBe(80000);
  });

  it('should return null when no config for that month', async () => {
    const config = await getConfigForMonth(2025, 1);
    expect(config).toBeNull();
  });
});

describe('getAllConfigs', () => {
  it('should return all configs sorted by effectiveFrom', async () => {
    const configs = await getAllConfigs();
    expect(configs.length).toBeGreaterThan(0);
    expect(configs[0].instructorHourlyRate).toBe(80000);
  });
});

describe('getCommissionForCourse', () => {
  it('should return commission for matching course', async () => {
    const configs = await getAllConfigs();
    const result = getCommissionForCourse(courseA1Id, new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 15), configs, {});
    expect(result.amount).toBe(10000);
  });

  it('should return 0 for unknown course', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = getCommissionForCourse(fakeId, new Date(), [], {});
    expect(result.amount).toBe(0);
  });

  it('should use user override when available', async () => {
    const configs = await getAllConfigs();
    const overrideMap = { [courseA1Id.toString()]: 99999 };
    const result = getCommissionForCourse(courseA1Id, new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 15), configs, overrideMap);
    expect(result.amount).toBe(99999);
    expect(result.isOverride).toBe(true);
  });
});

describe('getLeaveConfigForYear', () => {
  it('should return leave config for the year', async () => {
    const cfg = await getLeaveConfigForYear(FIXTURE_YEAR);
    expect(cfg.paidLeaveDaysPerYear).toBe(12);
    expect(cfg.leaveDeductionPerDay).toBe(0);
  });

  it('should auto-create default if not exists', async () => {
    await LeaveConfig.deleteMany({});
    const cfg = await getLeaveConfigForYear(2024);
    expect(cfg.year).toBe(2024);
    expect(cfg.paidLeaveDaysPerYear).toBe(12);
  });
});

// ============================================================
// TEST: Salary calculation edge cases
// ============================================================

describe('Salary Calculation — Core Logic', () => {
  describe('INSTRUCTOR: teaching salary + penalty', () => {
    it('BUG #1: salary should not go negative when penalty > income', async () => {
      // Instructor: 1 session x 80.000 = 80.000 total income
      // Penalty: 8.567.000
      // Expected: totalSalary should NOT be negative
      // Actual (BUG): totalSalary = 80.000 - 8.567.000 = -8.487.000

      // Mock request object
      const req = {
        userId: instructorId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      expect(call.status).toBe('success');
      const data = call.data;

      // Bug reproduction: totalSalary is negative
      expect(data.totalTeachingHours).toBe(1);
      expect(data.totalTeachingSessions).toBe(1);
      expect(data.teachingSalary).toBe(80000);
      expect(data.totalPenalty).toBe(8567000);

      // BUG: This assertion will FAIL, proving the bug exists
      // We expect totalSalary >= 0, but it returns -8.487.000
      expect(data.totalSalary).toBeGreaterThanOrEqual(0);
    });

    it('should cap penalty at total income (no negative salary)', async () => {
      // Same scenario as above, but we EXPECT the fix
      // When penalty > income, effectivePenalty = income (capped)
      // totalSalary = 80.000 - 80.000 = 0

      const req = {
        userId: instructorId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      const data = call.data;

      // FIXED: penalty should be capped at income
      // So totalSalary should be >= 0
      expect(data.totalSalary).toBeGreaterThanOrEqual(0);
    });
  });

  describe('CONSULTANT: commission + penalty (no base salary)', () => {
    it('BUG #2: consultant salary should not go negative', async () => {
      // Consultant: 1 doc x 10.000 commission = 10.000 total income
      // Penalty: 8.567.000
      // Expected: totalSalary should NOT be negative
      // Actual (BUG): totalSalary = 10.000 - 8.567.000 = -8.557.000

      const req = {
        userId: consultantId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      expect(call.status).toBe('success');
      const data = call.data;

      expect(data.totalCommission).toBe(10000);
      expect(data.totalDocuments).toBe(1);
      expect(data.totalPenalty).toBe(8567000);

      // BUG: This assertion will FAIL
      expect(data.totalSalary).toBeGreaterThanOrEqual(0);
    });

    it('should return zero salary when no income and only penalty', async () => {
      // Tạo consultant KHÔNG có document trong tháng
      await Document.deleteMany({ consultantId: consultantId });

      const req = {
        userId: consultantId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      const data = call.data;

      expect(data.totalCommission).toBe(0);
      expect(data.totalDocuments).toBe(0);
      expect(data.totalPenalty).toBe(8567000);

      // BUG: returns -8.567.000, should be 0
      expect(data.totalSalary).toBeGreaterThanOrEqual(0);
    });
  });

  describe('CONSULTANT: zero income, zero penalty', () => {
    it('should return 0 salary when no income and no penalty', async () => {
      await Document.deleteMany({ consultantId: consultantId });
      await Penalty.deleteMany({ user: consultantId });

      const req = {
        userId: consultantId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      const data = call.data;

      expect(data.totalSalary).toBe(0);
      expect(data.totalCommission).toBe(0);
      expect(data.totalPenalty).toBe(0);
    });
  });

  describe('INSTRUCTOR: positive salary with penalty within income', () => {
    it('should correctly calculate when penalty < income', async () => {
      await Penalty.deleteMany({});
      await Penalty.create({
        user: instructorId,
        amount: 30000,
        reason: 'Small penalty',
        date: new Date(FIXTURE_YEAR, FIXTURE_MONTH - 1, 20),
      });

      const req = {
        userId: instructorId,
        query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };

      await getMySalary(req, res);

      const call = res.json.mock.calls[0][0];
      const data = call.data;

      // 1 session x 80.000 = 80.000 salary
      // 30.000 penalty
      expect(data.teachingSalary).toBe(80000);
      expect(data.totalPenalty).toBe(30000);
      // BUG: returns 80.000 - 30.000 = 50.000 (correct)
      // FIXED: should also be 50.000
      expect(data.totalSalary).toBe(80000 - 30000);
    });
  });
});

// ============================================================
// TEST: SalaryReport persistence
// ============================================================

describe('SalaryReport upsert', () => {
  it('should create SalaryReport after getMySalary', async () => {
    const req = {
      userId: instructorId,
      query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getMySalary(req, res);

    const report = await SalaryReport.findOne({
      userId: instructorId,
      month: FIXTURE_MONTH,
      year: FIXTURE_YEAR,
    });

    expect(report).toBeTruthy();
    expect(report.status).toBe('DRAFT');
  });

  it('should upsert (update) SalaryReport on subsequent calls', async () => {
    const req1 = {
      userId: instructorId,
      query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
    };
    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await getMySalary(req1, res1);

    const report1 = await SalaryReport.findOne({ userId: instructorId, month: FIXTURE_MONTH, year: FIXTURE_YEAR });
    const createdAt1 = report1.createdAt;

    // Wait a tiny bit so createdAt differs
    await new Promise(r => setTimeout(r, 10));

    const req2 = {
      userId: instructorId,
      query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
    };
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await getMySalary(req2, res2);

    const count = await SalaryReport.countDocuments({ userId: instructorId, month: FIXTURE_MONTH, year: FIXTURE_YEAR });
    expect(count).toBe(1); // Only one record (upserted, not duplicated)
  });
});

// ============================================================
// TEST: Admin monthly summary
// ============================================================

describe('getMonthlySummary — Admin', () => {
  it('should return salary data for all INSTRUCTOR and CONSULTANT users', async () => {
    const req = {
      query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getMonthlySummary(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.status).toBe('success');
    expect(call.data.users.length).toBeGreaterThanOrEqual(2); // at least instructor + consultant
  });

  it('should return error when no salary config exists', async () => {
    await SalaryConfig.deleteMany({});

    const req = { query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    await getMonthlySummary(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.status).toBe('error');
    expect(call.message).toContain('cấu hình lương');
  });

  it('should filter by role', async () => {
    const req = {
      query: { month: FIXTURE_MONTH, year: FIXTURE_YEAR, role: 'INSTRUCTOR' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await getMonthlySummary(req, res);

    const call = res.json.mock.calls[0][0];
    const instructors = call.data.users.filter(u => u.role === 'INSTRUCTOR');
    const consultants = call.data.users.filter(u => u.role === 'CONSULTANT');
    expect(instructors.length).toBeGreaterThan(0);
    expect(consultants.length).toBe(0);
  });
});
