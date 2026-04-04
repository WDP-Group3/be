import SalaryConfig from '../models/SalaryConfig.js';
import SalaryReport from '../models/SalaryReport.js';
import LeaveConfig from '../models/LeaveConfig.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Document from '../models/Document.js';
import Penalty from '../models/Penalty.js';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import axios from 'axios';

// ============================================
// CONSTANTS
// ============================================
const DEFAULT_HOURLY_RATE = 80000;

// ============================================
// HELPER: Lấy cấu hình lương hiện tại (so với ngày hiện tại)
// ============================================
export const getActiveConfig = async () => {
  const config = await SalaryConfig.findOne({
    effectiveFrom: { $lte: new Date() },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: new Date() } }
    ]
  }).sort({ effectiveFrom: -1 });

  return config;
};

// ============================================
// HELPER: Lấy cấu hình lương áp dụng cho một tháng cụ thể
// ============================================
export const getConfigForMonth = async (year, month) => {
  // Lấy ngày giữa tháng để xác định config nào đang active
  const targetDate = new Date(year, month - 1, 15);
  const config = await SalaryConfig.findOne({
    effectiveFrom: { $lte: targetDate },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: targetDate } }
    ]
  }).sort({ effectiveFrom: -1 });

  return config;
};

// ============================================
// HELPER: Lấy tất cả cấu hình (để tìm effectiveFrom theo từng khóa)
// ============================================
export const getAllConfigs = async () => {
  return SalaryConfig.find().sort({ effectiveFrom: 1 }).lean();
};

// ============================================
// HELPER: Lấy cấu hình nghỉ phép cho một năm
// ============================================
export const getLeaveConfigForYear = async (year) => {
  let cfg = await LeaveConfig.findOne({ year }).lean();
  if (!cfg) {
    // Auto-create with defaults
    const newCfg = new LeaveConfig({ year, paidLeaveDaysPerYear: 12, leaveDeductionPerDay: 0 });
    await newCfg.save();
    cfg = newCfg.toObject();
  }
  return cfg;
};

// ============================================
// HELPER: Lấy commission đang áp dụng cho một khóa tại một ngày cụ thể
// Ưu tiên: user override > config.courseCommissions[].effectiveFrom
// ============================================
export const getCommissionForCourse = (courseId, docDate, configs, userOverrideMap = {}) => {
  const cid = courseId ? courseId.toString() : '';
  if (!cid) return { amount: 0, effectiveFrom: null, isOverride: false };
  // 1. User override (no date dependency)
  if (userOverrideMap && userOverrideMap[cid] !== undefined) {
    return { amount: userOverrideMap[cid], effectiveFrom: null, isOverride: true };
  }
  // 2. Find the config entry with the most recent effectiveDate <= docDate
  const safeConfigs = configs || [];
  let bestEntry = null;
  let bestEffDate = null;
  for (const cfg of safeConfigs) {
    const entry = cfg.courseCommissions.find(cc => cc.courseId.toString() === cid);
    if (!entry) continue;
    // effectiveDate = entry.effectiveFrom || config.effectiveFrom
    const entryEffDate = entry.effectiveFrom ? new Date(entry.effectiveFrom) : null;
    const cfgEffDate = cfg.effectiveFrom ? new Date(cfg.effectiveFrom) : null;
    const effectiveDate = entryEffDate || cfgEffDate;
    // Skip only if effectiveDate is in the future — null means "applies always" from this config
    if (effectiveDate && effectiveDate > docDate) continue;
    if (!effectiveDate || effectiveDate <= docDate) {
      // Null effectiveDate = applies always from this config (lowest priority)
      // Valid effectiveDate = applies from that date (higher priority)
      if (!bestEntry) {
        bestEntry = entry;
        bestEffDate = effectiveDate;
      } else if (effectiveDate !== null) {
        // Only override if this entry has a more recent effectiveDate than current best
        if (!bestEffDate || effectiveDate > bestEffDate) {
          bestEntry = entry;
          bestEffDate = effectiveDate;
        }
      }
    }
  }
  if (bestEntry) {
    return { amount: bestEntry.commissionAmount, effectiveFrom: bestEffDate, isOverride: false };
  }
  return { amount: 0, effectiveFrom: null, isOverride: false };
};


// ============================================
// HELPER: Tính lương cho một user trong tháng
// ============================================
const calculateSalary = async (userId, month, year, options = {}) => {
  const user = await User.findById(userId).lean();
  if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
    return null;
  }

  // Lấy tất cả configs để tìm commission theo effectiveFrom từng khóa
  const allConfigs = await getAllConfigs();

  // Lấy config đang active (dùng cho instructor hourly rate)
  // NOTE: Hệ thống chỉ hỗ trợ thanh toán theo giờ (hourly). Không có khái niệm
  // "lương cố định" — tổng lương luôn được tính = số buổi đã hoàn thành x lương/giờ.
  // Khi đổi từ mức lương này sang mức khác, các SalaryReport cũ vẫn giữ nguyên
  // (đã được snapshot) nhưng khi recalculate, hệ thống sẽ dùng config hiện tại.
  const activeConfig = await getConfigForMonth(year, month);
  const config = activeConfig;

  // Lấy danh sách courses
  const courses = await Course.find({ status: 'Active' }).lean();
  const courseMap = {};
  courses.forEach(c => {
    courseMap[c._id.toString()] = { code: c.code, name: c.name };
  });

  // Map user override (không phụ thuộc effectiveFrom)
  const userOverrideMap = {};
  if (Array.isArray(user.commissionOverrides) && user.commissionOverrides.length > 0) {
    user.commissionOverrides.forEach(ov => {
      if (ov?.courseId) {
        userOverrideMap[ov.courseId.toString()] = ov.commissionAmount || 0;
      }
    });
  }

  const hourlyRate = Number.isFinite(user.salaryHourlyRate)
    ? user.salaryHourlyRate
    : (config?.instructorHourlyRate || DEFAULT_HOURLY_RATE);

  const { courseIdFilter } = options;
  const applyCourseFilter = Boolean(courseIdFilter);

  // Tính ngày bắt đầu và kết thúc của tháng
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  let totalTeachingHours = 0;
  let totalTeachingSessions = 0;
  let totalCommission = 0;
  let totalDocuments = 0;
  const courseCounts = {};
  const teachingDetails = [];
  const commissionDetails = [];

  // === INSTRUCTOR: Tính giờ dạy ===
  if (user.role === 'INSTRUCTOR') {
    const bookings = await Booking.find({
      instructorId: userId,
      date: { $gte: startDate, $lte: endDate },
      attendance: 'PRESENT',
      status: 'COMPLETED'
    }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean();

    const filteredBookings = applyCourseFilter
      ? bookings.filter(b => b.batchId?.courseId?.toString() === courseIdFilter.toString())
      : bookings;

    totalTeachingSessions = filteredBookings.length;
    totalTeachingHours = filteredBookings.length;

    filteredBookings.forEach(booking => {
      teachingDetails.push({
        date: booking.date,
        timeSlot: booking.timeSlot,
        learnerName: booking.learnerId?.fullName || 'N/A',
        hours: 1,
        amount: hourlyRate
      });
    });
  }

  // === CONSULTANT: Tính hoa hồng hồ sơ ===
  if (user.role === 'CONSULTANT') {
    const docs = await Document.find({
      consultantId: userId,
      isDeleted: false
    }).populate({
      path: 'registrationId',
      populate: { path: 'courseId learnerId' }
    }).lean();

    const docsInMonth = docs.filter(doc => {
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = doc.registrationId?.createdAt ? new Date(doc.registrationId.createdAt) : null;
      const targetDate = docDate || regDate;
      return targetDate && targetDate >= startDate && targetDate <= endDate;
    });

    const filteredDocs = applyCourseFilter
      ? docsInMonth.filter(doc => {
        const reg = doc.registrationId;
        const courseId = reg?.courseId?._id?.toString() || reg?.courseId?.toString();
        return courseId && courseId === courseIdFilter.toString();
      })
      : docsInMonth;

    filteredDocs.forEach(doc => {
      const reg = doc.registrationId;
      if (!reg) return;

      const courseId = reg.courseId?._id?.toString() || reg.courseId?.toString();
      if (!courseId) return;

      // Xác định ngày ghi nhận hoa hồng
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = reg.createdAt ? new Date(reg.createdAt) : null;
      const recordDate = docDate || regDate;

      // Lấy commission đang áp dụng tại thời điểm record
      const { amount: commission } = getCommissionForCourse(courseId, recordDate, allConfigs, userOverrideMap);

      if (!courseCounts[courseId]) {
        courseCounts[courseId] = {
          courseId: reg.courseId?._id || reg.courseId,
          courseCode: courseMap[courseId]?.code || 'N/A',
          courseName: courseMap[courseId]?.name || 'N/A',
          count: 0
        };
      }
      courseCounts[courseId].count++;
      totalDocuments += 1;
      totalCommission += commission;

      commissionDetails.push({
        courseCode: courseMap[courseId]?.code || 'N/A',
        courseName: courseMap[courseId]?.name || 'N/A',
        learnerName: reg.learnerId?.fullName || 'N/A',
        learnerPhone: reg.learnerId?.phone || '',
        learnerEmail: reg.learnerId?.email || '',
        cccdNumber: doc.cccdNumber || '',
        photo: doc.photo || '',
        cccdImageFront: doc.cccdImageFront || '',
        cccdImageBack: doc.cccdImageBack || '',
        registrationDate: reg.firstPaymentDate || reg.createdAt || doc.createdAt,
        commissionAmount: commission
      });
    });
  }

  const teachingSalary = totalTeachingHours * hourlyRate;
  const totalSalaryBeforeDeduction = teachingSalary + totalCommission;
  const totalSalary = Math.max(0, totalSalaryBeforeDeduction);

  return {
    userId,
    role: user.role,
    userName: user.fullName,
    hourlyRate,
    teachingSalary,
    totalTeachingHours,
    totalTeachingSessions,
    totalCommission,
    totalSalary,
    totalDocuments,
    courseCounts: Object.values(courseCounts),
    teachingDetails,
    commissionDetails,
    configId: config?._id || null
  };
};

// ============================================
// HELPER: Tính khấu trừ nghỉ phép cho INSTRUCTOR
// ============================================
const computeLeaveDeduction = (userObj, leaveConfig, targetMonth, targetYear) => {
  if (!userObj || userObj.role !== 'INSTRUCTOR') return 0;
  if (!leaveConfig || !Number.isFinite(leaveConfig.paidLeaveDaysPerYear)) return 0;

  const paidDays = leaveConfig.paidLeaveDaysPerYear;
  const deductionPerDay = leaveConfig.leaveDeductionPerDay || 0;

  // Chỉ tính deduction nếu emergencyLeaveCount thuộc tháng đang xem
  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
  const lastMonth = userObj.lastEmergencyLeaveMonth || '';
  const leavesTaken = lastMonth === targetMonthStr ? (userObj.emergencyLeaveCount || 0) : 0;

  const extraLeaves = Math.max(0, leavesTaken - paidDays);
  return extraLeaves * deductionPerDay;
};

// ============================================
// API: Lấy cấu hình lương hiện tại (GET)
// ============================================
export const getSalaryConfig = async (_req, res) => {
  try {
    const config = await getActiveConfig();
    const courses = await Course.find({ status: 'Active' }).lean();

    // Build course map
    const courseMap = {};
    courses.forEach(c => {
      courseMap[c._id.toString()] = { code: c.code, name: c.name };
    });

    if (!config) {
      // Trả về cấu hình mặc định
      return res.json({
        status: 'success',
        data: {
          courseCommissions: courses.map(c => ({
            courseId: { _id: c._id, code: c.code, name: c.name },
            commissionAmount: 0
          })),
          instructorHourlyRate: DEFAULT_HOURLY_RATE,
          effectiveFrom: new Date(),
          isNew: true
        }
      });
    }

    // Map course info vào commission
    const populatedCommissions = config.courseCommissions.map(cc => ({
      courseId: {
        _id: cc.courseId,
        code: courseMap[cc.courseId.toString()]?.code || 'N/A',
        name: courseMap[cc.courseId.toString()]?.name || 'N/A'
      },
      commissionAmount: cc.commissionAmount,
      effectiveFrom: cc.effectiveFrom ? new Date(cc.effectiveFrom).toISOString().split('T')[0] : null
    }));

    res.json({
      status: 'success',
      data: {
        ...config.toObject(),
        courseCommissions: populatedCommissions,
        isNew: false
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Tạo cấu hình lương (POST)
// ============================================
export const createSalaryConfig = async (req, res) => {
  try {
    const { courseCommissions, instructorHourlyRate, effectiveFrom, effectiveTo, note } = req.body;

    // Validate
    if (!instructorHourlyRate || instructorHourlyRate <= 0) {
      return res.status(400).json({ status: 'error', message: 'Lương theo giờ không hợp lệ' });
    }

    if (!effectiveFrom) {
      return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực là bắt buộc' });
    }

    const effDate = new Date(effectiveFrom + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (effDate < today) {
      return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực không được là ngày trong quá khứ' });
    }

    // Validate course commission dates
    if (courseCommissions && Array.isArray(courseCommissions)) {
      for (const cc of courseCommissions) {
        if (cc.effectiveFrom) {
          const ccEffDate = new Date(cc.effectiveFrom + 'T00:00:00');
          if (ccEffDate < today) {
            return res.status(400).json({ status: 'error', message: `Ngày hiệu lực hoa hồng của khóa học không được là ngày trong quá khứ` });
          }
        }
      }
    }

    // Validate effectiveTo > effectiveFrom
    if (effectiveTo) {
      const toDate = new Date(effectiveTo + 'T00:00:00');
      if (toDate <= effDate) {
        return res.status(400).json({ status: 'error', message: 'Ngày kết thúc phải sau ngày hiệu lực' });
      }
    }


    const config = new SalaryConfig({
      courseCommissions: courseCommissions || [],
      instructorHourlyRate,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      note: note || '',
      createdBy: req.user?.id
    });

    await config.save();

    res.status(201).json({
      status: 'success',
      message: 'Cấu hình lương đã được tạo',
      data: config
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Cập nhật cấu hình lương (PUT)
// ============================================
export const updateSalaryConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { courseCommissions, instructorHourlyRate, effectiveFrom, effectiveTo, note } = req.body;

    const config = await SalaryConfig.findById(id);
    if (!config) {
      return res.status(404).json({ status: 'error', message: 'Cấu hình không tồn tại' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (effectiveFrom) {
      const newEffDate = new Date(effectiveFrom + 'T00:00:00');
      if (newEffDate < today) {
        return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực không được là ngày trong quá khứ' });
      }
      config.effectiveFrom = newEffDate;
    }
    if (courseCommissions) {
      for (const cc of courseCommissions) {
        if (cc.effectiveFrom) {
          const ccEffDate = new Date(cc.effectiveFrom + 'T00:00:00');
          if (ccEffDate < today) {
            return res.status(400).json({ status: 'error', message: `Ngày hiệu lực hoa hồng của khóa học không được là ngày trong quá khứ` });
          }
        }
      }
      config.courseCommissions = courseCommissions;
    }
    if (effectiveTo) {
      const toDate = new Date(effectiveTo + 'T00:00:00');
      const fromDate = effectiveFrom
        ? new Date(effectiveFrom + 'T00:00:00')
        : new Date(config.effectiveFrom);
      if (toDate <= fromDate) {
        return res.status(400).json({ status: 'error', message: 'Ngày kết thúc phải sau ngày hiệu lực' });
      }
      config.effectiveTo = toDate;
    }
    if (instructorHourlyRate) config.instructorHourlyRate = instructorHourlyRate;
    if (note !== undefined) config.note = note;

    await config.save();

    res.json({
      status: 'success',
      message: 'Cấu hình lương đã được cập nhật',
      data: config
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy danh sách cấu hình lương (GET all)
// ============================================
export const getAllSalaryConfigs = async (_req, res) => {
  try {
    const configs = await SalaryConfig.find()
      .sort({ effectiveFrom: -1 })
      .populate('courseCommissions.courseId', 'code name')
      .lean();

    res.json({
      status: 'success',
      data: configs
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy danh sách courses (dùng cho filter cột động)
// ============================================
export const getCoursesForSalary = async (_req, res) => {
  try {
    const courses = await Course.find({ status: 'Active' }).sort({ code: 1 }).lean();
    res.json({
      status: 'success',
      data: courses
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// HELPER: Tính lương cho NHIỀU user cùng lúc với data đã pre-fetch
// ============================================
const calculateSalaryBatch = async (users, targetMonth, targetYear, options, sharedData) => {
  const { allConfigs, courses, courseMap, bookingsByInstructor, docsByConsultant, config, courseIdFilter, leaveConfig, penaltiesByUserId } = sharedData;
  const results = [];
  for (const user of users) {
    const salaryData = calculateSalaryWithSharedData(
      user._id, targetMonth, targetYear, options,
      allConfigs, courses, courseMap, bookingsByInstructor, docsByConsultant, config,
      user, leaveConfig, penaltiesByUserId
    );

    if (salaryData) {
      const courseCountMap = {};
      salaryData.courseCounts.forEach(cc => {
        const key = cc.courseId?.toString() || cc.courseCode;
        courseCountMap[key] = cc.count;
      });

      if (courseIdFilter && user.role === 'CONSULTANT') {
        const matchedCourse = salaryData.courseCounts.find(cc => cc.courseId?.toString() === courseIdFilter.toString());
        if (!matchedCourse) {
          continue;
        }
      }

      const hasOverride = (
        Number.isFinite(user.salaryHourlyRate) ||
        (Array.isArray(user.commissionOverrides) && user.commissionOverrides.length > 0)
      );

      results.push({
        _id: user._id,
        userId: user._id,
        fullName: user.fullName,
        role: user.role,
        hourlyRate: salaryData.hourlyRate,
        teachingSalary: salaryData.teachingSalary,
        totalTeachingHours: salaryData.totalTeachingHours,
        totalTeachingSessions: salaryData.totalTeachingSessions,
        totalCommission: salaryData.totalCommission,
        totalDocuments: salaryData.totalDocuments,
        leaveDeduction: salaryData.leaveDeduction || 0,
        totalPenalty: salaryData.totalPenalty || 0,
        totalSalary: salaryData.totalSalary,
        courseCounts: courseCountMap,
        courseCountDetails: salaryData.courseCounts,
        hasOverride,
        salaryData: salaryData
      });
    }
  }

  return results;
};

// ============================================
// HELPER: Tính lương với data đã pre-fetch (không query lại DB)
// userObj là object đã được lean() sẵn, không query lại
// ============================================
const calculateSalaryWithSharedData = (
  userId, targetMonth, targetYear, options,
  allConfigs, courses, courseMap, bookingsByInstructor, docsByConsultant, config,
  userObj, leaveConfig, penaltiesByUserId
) => {
  const user = userObj;
  if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
    return null;
  }

  const hourlyRate = Number.isFinite(user.salaryHourlyRate)
    ? user.salaryHourlyRate
    : (config?.instructorHourlyRate || DEFAULT_HOURLY_RATE);

  const { courseIdFilter } = options;
  const applyCourseFilter = Boolean(courseIdFilter);

  const startDate = new Date(targetYear, targetMonth - 1, 1);
  const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

  let totalTeachingHours = 0;
  let totalTeachingSessions = 0;
  let totalCommission = 0;
  let totalDocuments = 0;
  const courseCounts = {};
  const teachingDetails = [];
  const commissionDetails = [];

  // User override map
  const userOverrideMap = {};
  if (Array.isArray(user.commissionOverrides) && user.commissionOverrides.length > 0) {
    user.commissionOverrides.forEach(ov => {
      if (ov?.courseId) {
        userOverrideMap[ov.courseId.toString()] = ov.commissionAmount || 0;
      }
    });
  }

  // === INSTRUCTOR ===
  if (user.role === 'INSTRUCTOR') {
    const bookings = (bookingsByInstructor[userId.toString()] || []).filter(b => {
      if (b.attendance !== 'PRESENT' || b.status !== 'COMPLETED') return false;
      if (applyCourseFilter && b.batchId?.courseId?.toString() !== courseIdFilter.toString()) return false;
      return true;
    });

    totalTeachingSessions = bookings.length;
    totalTeachingHours = bookings.length;

    bookings.forEach(booking => {
      teachingDetails.push({
        date: booking.date,
        timeSlot: booking.timeSlot,
        learnerName: booking.learnerId?.fullName || 'N/A',
        hours: 1,
        amount: hourlyRate
      });
    });
  }

  // === CONSULTANT ===
  if (user.role === 'CONSULTANT') {
    const rawDocs = docsByConsultant[userId.toString()] || [];
    const docs = rawDocs.filter(doc => {
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = doc.registrationId?.createdAt ? new Date(doc.registrationId.createdAt) : null;
      const targetDate = docDate || regDate;
      if (!targetDate || targetDate < startDate || targetDate > endDate) return false;
      if (!doc.registrationId?.courseId) return false;
      const courseId = doc.registrationId.courseId._id?.toString() || doc.registrationId.courseId.toString();
      if (applyCourseFilter && courseId !== courseIdFilter.toString()) return false;
      return true;
    });

    docs.forEach(doc => {
      const reg = doc.registrationId;
      const courseId = reg.courseId._id?.toString() || reg.courseId.toString();
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = reg.createdAt ? new Date(reg.createdAt) : null;
      const recordDate = docDate || regDate;
      const { amount: commission } = getCommissionForCourse(courseId, recordDate, allConfigs, userOverrideMap);

      if (!courseCounts[courseId]) {
        courseCounts[courseId] = {
          courseId: reg.courseId._id || reg.courseId,
          courseCode: courseMap[courseId]?.code || 'N/A',
          courseName: courseMap[courseId]?.name || 'N/A',
          count: 0
        };
      }
      courseCounts[courseId].count++;
      totalDocuments += 1;
      totalCommission += commission;

      commissionDetails.push({
        courseCode: courseMap[courseId]?.code || 'N/A',
        courseName: courseMap[courseId]?.name || 'N/A',
        learnerName: reg.learnerId?.fullName || 'N/A',
        learnerPhone: reg.learnerId?.phone || '',
        learnerEmail: reg.learnerId?.email || '',
        cccdNumber: doc.cccdNumber || '',
        photo: doc.photo || '',
        cccdImageFront: doc.cccdImageFront || '',
        cccdImageBack: doc.cccdImageBack || '',
        registrationDate: reg.firstPaymentDate || reg.createdAt || doc.createdAt,
        commissionAmount: commission
      });
    });
  }

  const teachingSalary = totalTeachingHours * hourlyRate;
  const totalSalaryBeforeDeduction = teachingSalary + totalCommission;

  let totalPenalty = 0;
  const penaltiesArr = (typeof penaltiesByUserId === 'object' && penaltiesByUserId !== null)
    ? (Array.isArray(penaltiesByUserId)
        ? penaltiesByUserId
        : (penaltiesByUserId[userId] || []))
    : [];
  if (penaltiesArr.length > 0) {
    totalPenalty = penaltiesArr.reduce((sum, p) => sum + (p.amount || 0), 0);
  }

  // Compute leave deduction for INSTRUCTOR only
  const leaveDeduction = computeLeaveDeduction(user, leaveConfig, targetMonth, targetYear);
  const effectivePenalty = Math.min(totalPenalty, totalSalaryBeforeDeduction);
  const totalSalary = Math.max(0, totalSalaryBeforeDeduction - leaveDeduction - effectivePenalty);

  return {
    userId,
    role: user.role,
    userName: user.fullName,
    hourlyRate,
    teachingSalary,
    totalTeachingHours,
    totalTeachingSessions,
    totalCommission,
    leaveDeduction,
    totalPenalty,
    totalSalary,
    totalSalaryBeforeDeduction,
    totalDocuments,
    courseCounts: Object.values(courseCounts),
    teachingDetails,
    commissionDetails,
    configId: config?._id || null
  };
};

// ============================================
// API: Lấy tổng lương tháng (Admin) - GET
// ============================================
export const getMonthlySummary = async (req, res) => {
  try {
    const { month, year, role, search, courseId, page = 1, limit = 10 } = req.query;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    const userFilter = { role: { $in: ['INSTRUCTOR', 'CONSULTANT'] }, status: 'ACTIVE' };
    if (role) {
      userFilter.role = role;
    }
    if (search) {
      // Case-insensitive regex search on fullName.
      // countDocuments includes this filter, so total/pagination are accurate even with a search term.
      userFilter.fullName = { $regex: search, $options: 'i' };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(userFilter);

    // Pre-fetch: lấy ALL users (cho stats) + paginated users (cho bảng)
    const [config, allConfigs, courses, allUsers, paginatedUsers, leaveConfig] = await Promise.all([
      getConfigForMonth(targetYear, targetMonth),
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
      User.find(userFilter).lean(),
      User.find(userFilter).skip(skip).limit(parseInt(limit)).sort({ fullName: 1 }).lean(),
      getLeaveConfigForYear(targetYear),
    ]);

    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương. Vui lòng cấu hình trước.'
      });
    }

    const courseMap = {};
    courses.forEach(c => {
      courseMap[c._id.toString()] = { code: c.code, name: c.name };
    });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    // Pre-fetch data cho TẤT CẢ users (cho stats tổng)
    const allInstructorIds = allUsers.filter(u => u.role === 'INSTRUCTOR').map(u => u._id);
    const allConsultantIds = allUsers.filter(u => u.role === 'CONSULTANT').map(u => u._id);

    const [allBookings, allDocs, allPenalties] = await Promise.all([
      allInstructorIds.length > 0
        ? Booking.find({
          instructorId: { $in: allInstructorIds },
          date: { $gte: startDate, $lte: endDate }
        }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean()
        : Promise.resolve([]),
      allConsultantIds.length > 0
        ? Document.find({
          consultantId: { $in: allConsultantIds },
          isDeleted: false,
          createdAt: { $gte: startDate, $lte: endDate }
        }).populate({
          path: 'registrationId',
          populate: { path: 'courseId learnerId' }
        }).lean()
        : Promise.resolve([]),
      allUsers.length > 0
        ? Penalty.find({
          user: { $in: allUsers.map(u => u._id) },
          date: { $gte: startDate, $lte: endDate }
        }).lean()
        : Promise.resolve([])
    ]);

    // Group bookings by instructor
    const bookingsByInstructor = {};
    allBookings.forEach(b => {
      const iid = b.instructorId.toString();
      if (!bookingsByInstructor[iid]) bookingsByInstructor[iid] = [];
      bookingsByInstructor[iid].push(b);
    });

    // Group docs by consultant
    const docsByConsultant = {};
    allDocs.forEach(doc => {
      const cid = doc.consultantId.toString();
      if (!docsByConsultant[cid]) docsByConsultant[cid] = [];
      docsByConsultant[cid].push(doc);
    });
    // Tính stats trên TẤT CẢ users

    const sharedDataAll = {
      allConfigs,
      courses,
      courseMap,
      bookingsByInstructor,
      docsByConsultant,
      config,
      courseIdFilter: courseId,
      leaveConfig,
      penaltiesByUserId: allPenalties
    };
    const allResults = await calculateSalaryBatch(allUsers, targetMonth, targetYear, { courseIdFilter: courseId }, sharedDataAll);
    const totalStats = {
      totalSalary: allResults.reduce((s, u) => s + (u.totalSalary || 0), 0),
      totalHours: allResults.reduce((s, u) => s + (u.totalTeachingHours || 0), 0),
      totalCommission: allResults.reduce((s, u) => s + (u.totalCommission || 0), 0),
      totalPenalty: allResults.reduce((s, u) => s + (u.totalPenalty || 0), 0),
      totalDocuments: allResults.reduce((s, u) => s + (u.totalDocuments || 0), 0),
      instructorCount: allResults.filter(u => u.role === 'INSTRUCTOR').length,
      consultantCount: allResults.filter(u => u.role === 'CONSULTANT').length,
    };

    // Tính results cho paginated users (dùng lại data đã pre-fetch ở trên)
    const paginatedIds = paginatedUsers.map(u => u._id.toString());

    const paginatedResults = allResults.filter(u => paginatedIds.includes(u.userId.toString()));

    res.json({
      status: 'success',
      data: {
        users: paginatedResults,
        totalStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        },
        filter: {
          month: targetMonth,
          year: targetYear,
          role,
          courseId
        },
        courses: courses.map(c => ({ _id: c._id, code: c.code, name: c.name }))
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy chi tiết lương của một user (Admin - Export)
// ============================================
export const getSalaryDetail = async (req, res) => {
  try {
    const { userId, month, year, courseId } = req.query;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId là bắt buộc' });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    const [config, allConfigs, courses, user, leaveConfig] = await Promise.all([
      getConfigForMonth(targetYear, targetMonth),
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
      User.findById(userId).lean(),
      getLeaveConfigForYear(targetYear),
    ]);

    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs, allPenalties] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
      Penalty.find({ user: userId, date: { $gte: startDate, $lte: endDate } }).lean(),
    ]);
    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig,
      { [userId]: allPenalties }
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    res.json({ status: 'success', data: salaryData });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lương của tôi (User - Instructor/Consultant)
// ============================================
export const getMySalary = async (req, res) => {
  try {
    const userId = req.userId;
    const { month, year, courseId } = req.query;

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Chưa đăng nhập' });
    }

    const user = await User.findById(userId);
    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem lương' });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    const config = await getConfigForMonth(targetYear, targetMonth);
    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const [allConfigs, courses, leaveConfig] = await Promise.all([
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
      getLeaveConfigForYear(targetYear),
    ]);

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs, allPenalties] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
      Penalty.find({ user: userId, date: { $gte: startDate, $lte: endDate } }).lean(),
    ]);

    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig,
      { [userId]: allPenalties }
    );

    res.json({
      status: 'success',
      data: {
        ...salaryData,
        filter: { month: targetMonth, year: targetYear, courseId }
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Export CSV lương của tôi (Instructor/Consultant)
// ============================================
export const exportMySalaryCSV = async (req, res) => {
  try {
    const userId = req.userId;
    const { month, year, courseId } = req.query;

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Chưa đăng nhập' });
    }

    const user = await User.findById(userId).lean();
    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xuất lương' });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    const [config, allConfigs, courses] = await Promise.all([
      getConfigForMonth(targetYear, targetMonth),
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
    ]);

    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs, allPenalties] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
      Penalty.find({ user: userId, date: { $gte: startDate, $lte: endDate } }).lean(),
    ]);

    const leaveConfig = await getLeaveConfigForYear(targetYear);
    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig,
      { [userId]: allPenalties }
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const excelBuffer = await buildSalaryExcel(salaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_${salaryData.userName}_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy override lương/hoa hồng theo user (Admin)
// ============================================
export const getUserSalaryOverride = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('fullName role salaryHourlyRate commissionOverrides').populate('commissionOverrides.courseId', 'code name').lean();

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User không tồn tại' });
    }

    if (!['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(400).json({ status: 'error', message: 'User không phải Instructor/Consultant' });
    }

    return res.json({
      status: 'success',
      data: user
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Cập nhật override lương/hoa hồng theo user (Admin)
// ============================================
export const updateUserSalaryOverride = async (req, res) => {
  try {
    const { id } = req.params;
    const { salaryHourlyRate, commissionOverrides } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User không tồn tại' });
    }

    if (!['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(400).json({ status: 'error', message: 'User không phải Instructor/Consultant' });
    }

    if (salaryHourlyRate !== undefined) {
      user.salaryHourlyRate = salaryHourlyRate === null || salaryHourlyRate === '' ? null : Number(salaryHourlyRate);
    }

    if (Array.isArray(commissionOverrides)) {
      user.commissionOverrides = commissionOverrides.map(c => ({
        courseId: c.courseId,
        commissionAmount: Number(c.commissionAmount || 0)
      }));
    }

    await user.save();

    return res.json({
      status: 'success',
      message: 'Cập nhật override thành công',
      data: {
        _id: user._id,
        fullName: user.fullName,
        role: user.role,
        salaryHourlyRate: user.salaryHourlyRate,
        commissionOverrides: user.commissionOverrides
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy cấu hình nghỉ phép (GET /salary/leave-config)
// ============================================
export const getLeaveConfig = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const cfg = await getLeaveConfigForYear(year);
    res.json({ status: 'success', data: cfg });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Cập nhật cấu hình nghỉ phép (PUT /salary/leave-config)
// ============================================
export const updateLeaveConfig = async (req, res) => {
  try {
    const { paidLeaveDaysPerYear, leaveDeductionPerDay, year } = req.body;
    const targetYear = year || new Date().getFullYear();

    if (paidLeaveDaysPerYear !== undefined && (paidLeaveDaysPerYear < 0 || !Number.isFinite(paidLeaveDaysPerYear))) {
      return res.status(400).json({ status: 'error', message: 'Số ngày nghỉ phép không hợp lệ' });
    }
    if (leaveDeductionPerDay !== undefined && (leaveDeductionPerDay < 0 || !Number.isFinite(leaveDeductionPerDay))) {
      return res.status(400).json({ status: 'error', message: 'Số tiền khấu trừ không hợp lệ' });
    }

    let cfg = await LeaveConfig.findOne({ year: targetYear });
    if (!cfg) {
      cfg = new LeaveConfig({ year: targetYear });
    }
    if (paidLeaveDaysPerYear !== undefined) cfg.paidLeaveDaysPerYear = paidLeaveDaysPerYear;
    if (leaveDeductionPerDay !== undefined) cfg.leaveDeductionPerDay = leaveDeductionPerDay;
    await cfg.save();

    res.json({ status: 'success', message: 'Cập nhật cấu hình nghỉ phép thành công', data: cfg });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Xem usage nghỉ phép của instructors (GET /salary/leave-usage)
// ============================================
export const getLeaveUsage = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const leaveConfig = await getLeaveConfigForYear(year);

    const instructors = await User.find({ role: 'INSTRUCTOR', status: 'ACTIVE' })
      .select('fullName emergencyLeaveCount emergencyLeaveOverflowCount lastEmergencyLeaveMonth')
      .sort({ fullName: 1 })
      .lean();

    const usage = instructors.map(instructor => {
      const lastMonth = instructor.lastEmergencyLeaveMonth || '';
      const leavesTaken = lastMonth.startsWith(String(year)) ? (instructor.emergencyLeaveCount || 0) : 0;
      const paidDays = leaveConfig.paidLeaveDaysPerYear || 12;
      const deductionPerDay = leaveConfig.leaveDeductionPerDay || 0;
      const extraDays = Math.max(0, leavesTaken - paidDays);
      const deduction = extraDays * deductionPerDay;
      return {
        userId: instructor._id,
        fullName: instructor.fullName,
        emergencyLeaveCount: leavesTaken,
        paidLeaveDays: paidDays,
        extraLeaveDays: extraDays,
        leaveDeductionPerDay: deductionPerDay,
        leaveDeduction: deduction,
        lastEmergencyLeaveMonth: instructor.lastEmergencyLeaveMonth,
      };
    });

    res.json({
      status: 'success',
      data: {
        config: leaveConfig,
        year,
        instructors: usage,
        summary: {
          totalInstructors: usage.length,
          totalLeaves: usage.reduce((s, i) => s + i.emergencyLeaveCount, 0),
          totalExtraDays: usage.reduce((s, i) => s + i.extraLeaveDays, 0),
          totalDeduction: usage.reduce((s, i) => s + i.leaveDeduction, 0),
        },
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// HELPER: Tạo file Excel từ salary data (có ảnh học viên)
// ============================================
const buildSalaryExcel = async (salaryData, targetMonth, targetYear) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DriveCenter System';
  wb.created = new Date();

  // Sheet 1: Tổng quan
  const wsOverview = wb.addWorksheet('Tổng quan');
  wsOverview.getCell('A1').value = 'BẢNG LƯƠNG THÁNG';
  wsOverview.getCell('A1').font = { bold: true, size: 14 };
  wsOverview.getCell('B1').value = `${targetMonth}/${targetYear}`;
  wsOverview.getCell('A2').value = 'Họ tên';
  wsOverview.getCell('B2').value = salaryData.userName;
  wsOverview.getCell('A3').value = 'Vai trò';
  wsOverview.getCell('B3').value = salaryData.role === 'INSTRUCTOR' ? 'Giảng viên' : 'Tư vấn viên';
  wsOverview.getCell('A5').value = 'TỔNG QUAN';
  wsOverview.getCell('A5').font = { bold: true };
  wsOverview.getCell('A6').value = 'Tổng giờ dạy';
  wsOverview.getCell('B6').value = salaryData.totalTeachingHours;
  wsOverview.getCell('A7').value = 'Tổng số buổi';
  wsOverview.getCell('B7').value = salaryData.totalTeachingSessions;
  wsOverview.getCell('A8').value = 'Tổng hoa hồng';
  wsOverview.getCell('B8').value = salaryData.totalCommission;
  wsOverview.getCell('A9').value = 'Tổng lương';
  wsOverview.getCell('B9').value = salaryData.totalSalary;
  wsOverview.getColumn(1).width = 20;
  wsOverview.getColumn(2).width = 20;

  // Sheet 2: Chi tiết giờ dạy (INSTRUCTOR)
  if (salaryData.teachingDetails && salaryData.teachingDetails.length > 0) {
    const wsTeaching = wb.addWorksheet('Chi tiết giờ dạy');
    wsTeaching.addRow(['Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền']);
    const headerRow = wsTeaching.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    salaryData.teachingDetails.forEach(d => {
      wsTeaching.addRow([
        new Date(d.date).toLocaleDateString('vi-VN'),
        d.timeSlot,
        d.learnerName,
        d.hours,
        d.amount,
      ]);
    });
    ['Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền'].forEach((_, i) => {
      wsTeaching.getColumn(i + 1).width = 18;
    });
  }

  // Sheet 3: Chi tiết hoa hồng (CONSULTANT) - có ảnh
  if (salaryData.commissionDetails && salaryData.commissionDetails.length > 0) {
    const wsCommission = wb.addWorksheet('Chi tiết hoa hồng');
    const headers = ['Khóa học', 'Tên học viên', 'SĐT', 'Email', 'CCCD', 'Ngày nhận', 'Hoa hồng', 'Ảnh 3x4', 'CCCD trước', 'CCCD sau'];
    wsCommission.addRow(headers);
    const headerRow = wsCommission.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    wsCommission.getColumn(1).width = 22; // Khóa học
    wsCommission.getColumn(2).width = 20; // Tên học viên
    wsCommission.getColumn(3).width = 13; // SĐT
    wsCommission.getColumn(4).width = 25; // Email
    wsCommission.getColumn(5).width = 14; // CCCD
    wsCommission.getColumn(6).width = 14; // Ngày nhận
    wsCommission.getColumn(7).width = 12; // Hoa hồng
    wsCommission.getColumn(8).width = 5;  // Ảnh 3x4
    wsCommission.getColumn(9).width = 5;  // CCCD trước
    wsCommission.getColumn(10).width = 5; // CCCD sau

    for (const d of salaryData.commissionDetails) {
      const row = wsCommission.addRow([
        `${d.courseCode} - ${d.courseName}`,
        d.learnerName,
        d.learnerPhone || '',
        d.learnerEmail || '',
        d.cccdNumber || '',
        new Date(d.registrationDate).toLocaleDateString('vi-VN'),
        d.commissionAmount,
        '', // placeholder for image
        '',
        '',
      ]);

      // Set row height to accommodate images
      row.height = 80;

      // Embed ảnh 3x4
      if (d.photo) {
        try {
          const imgResponse = await axios.get(d.photo, { responseType: 'arraybuffer' });
          const imgId = wb.addImage({
            base64: Buffer.from(imgResponse.data).toString('base64'),
            extension: 'jpeg',
          });
          wsCommission.addImage(imgId, {
            tl: { col: 7, row: row.number - 1 },
            ext: { width: 60, height: 80 },
          });
        } catch (err) {
          console.warn(`[buildSalaryExcel] Cannot load photo: ${d.photo}`);
        }
      }

      // Embed CCCD mặt trước
      if (d.cccdImageFront) {
        try {
          const imgResponse = await axios.get(d.cccdImageFront, { responseType: 'arraybuffer' });
          const imgId = wb.addImage({
            base64: Buffer.from(imgResponse.data).toString('base64'),
            extension: 'jpeg',
          });
          wsCommission.addImage(imgId, {
            tl: { col: 8, row: row.number - 1 },
            ext: { width: 60, height: 80 },
          });
        } catch (err) {
          console.warn(`[buildSalaryExcel] Cannot load cccdImageFront: ${d.cccdImageFront}`);
        }
      }

      // Embed CCCD mặt sau
      if (d.cccdImageBack) {
        try {
          const imgResponse = await axios.get(d.cccdImageBack, { responseType: 'arraybuffer' });
          const imgId = wb.addImage({
            base64: Buffer.from(imgResponse.data).toString('base64'),
            extension: 'jpeg',
          });
          wsCommission.addImage(imgId, {
            tl: { col: 9, row: row.number - 1 },
            ext: { width: 60, height: 80 },
          });
        } catch (err) {
          console.warn(`[buildSalaryExcel] Cannot load cccdImageBack: ${d.cccdImageBack}`);
        }
      }
    }
  }

  // Sheet 4: Tổng hợp theo khóa học
  if (salaryData.courseCounts && salaryData.courseCounts.length > 0) {
    const wsCourse = wb.addWorksheet('Theo khóa học');
    wsCourse.addRow(['Khóa học', 'Số lượng']);
    wsCourse.getRow(1).font = { bold: true };
    wsCourse.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    wsCourse.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    salaryData.courseCounts.forEach(cc => {
      wsCourse.addRow([`${cc.courseCode} - ${cc.courseName}`, cc.count]);
    });
    wsCourse.getColumn(1).width = 30;
    wsCourse.getColumn(2).width = 12;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
};

// ============================================
// HELPER: Build Excel tất cả lương (nhiều user) - có ảnh học viên
// ============================================
const buildAllSalaryExcel = async (allSalaryData, targetMonth, targetYear) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DriveCenter System';
  wb.created = new Date();

  // Sheet 1: Tổng hợp
  const wsSummary = wb.addWorksheet('Tổng hợp');
  wsSummary.getCell('A1').value = 'BẢNG LƯƠNG THÁNG';
  wsSummary.getCell('A1').font = { bold: true, size: 14 };
  wsSummary.getCell('B1').value = `${targetMonth}/${targetYear}`;
  wsSummary.getCell('A2').value = 'Ngày xuất';
  wsSummary.getCell('B2').value = new Date().toLocaleString('vi-VN');
  wsSummary.getCell('A3').value = 'Tổng nhân viên';
  wsSummary.getCell('B3').value = allSalaryData.length;
  wsSummary.getColumn(1).width = 20;
  wsSummary.getColumn(2).width = 20;

  const summaryHeaders = ['STT', 'Họ tên', 'Vai trò', 'Tổng giờ dạy', 'Tổng số buổi', 'Hoa hồng', 'Tổng lương'];
  wsSummary.addRow(summaryHeaders);
  const summaryHeaderRow = wsSummary.getRow(5);
  summaryHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summaryHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  let stt = 1;
  allSalaryData.forEach((sd) => {
    wsSummary.addRow([
      stt++,
      sd.userName,
      sd.role === 'INSTRUCTOR' ? 'Giảng viên' : 'Tư vấn viên',
      sd.totalTeachingHours,
      sd.totalTeachingSessions,
      sd.totalCommission,
      sd.totalSalary,
    ]);
  });
  ['STT', 'Họ tên', 'Vai trò', 'Tổng giờ dạy', 'Tổng số buổi', 'Hoa hồng', 'Tổng lương'].forEach((_, i) => {
    wsSummary.getColumn(i + 1).width = i === 1 ? 20 : 15;
  });

  // Sheet 2: Chi tiết giờ dạy (tất cả instructor)
  const allTeaching = allSalaryData.filter(sd => sd.role === 'INSTRUCTOR');
  if (allTeaching.length > 0 && allTeaching.some(sd => (sd.teachingDetails || []).length > 0)) {
    const wsTeaching = wb.addWorksheet('Chi tiết giờ dạy');
    wsTeaching.addRow(['STT', 'Họ tên GV', 'Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền']);
    const tHeaderRow = wsTeaching.getRow(1);
    tHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    tHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    let teachingIdx = 1;
    allTeaching.forEach((sd) => {
      (sd.teachingDetails || []).forEach(d => {
        wsTeaching.addRow([
          teachingIdx++,
          sd.userName,
          new Date(d.date).toLocaleDateString('vi-VN'),
          d.timeSlot,
          d.learnerName,
          d.hours,
          d.amount,
        ]);
      });
    });
    ['STT', 'Họ tên GV', 'Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền'].forEach((_, i) => {
      wsTeaching.getColumn(i + 1).width = 18;
    });
  }

  // Sheet 3: Chi tiết hoa hồng (tất cả consultant) - có ảnh
  const allConsultants = allSalaryData.filter(sd => sd.role === 'CONSULTANT');
  const hasCommission = allConsultants.some(sd => (sd.commissionDetails || []).length > 0);
  if (hasCommission) {
    const wsCommission = wb.addWorksheet('Chi tiết hoa hồng');
    const headers = ['STT', 'Tư vấn viên', 'Khóa học', 'Tên học viên', 'SĐT', 'Email', 'CCCD', 'Ngày nhận', 'Hoa hồng', 'Ảnh 3x4', 'CCCD trước', 'CCCD sau'];
    wsCommission.addRow(headers);
    const cHeaderRow = wsCommission.getRow(1);
    cHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    wsCommission.getColumn(1).width = 6;   // STT
    wsCommission.getColumn(2).width = 18;  // Tư vấn viên
    wsCommission.getColumn(3).width = 22;  // Khóa học
    wsCommission.getColumn(4).width = 20;  // Tên học viên
    wsCommission.getColumn(5).width = 13;  // SĐT
    wsCommission.getColumn(6).width = 25;   // Email
    wsCommission.getColumn(7).width = 14;   // CCCD
    wsCommission.getColumn(8).width = 14;  // Ngày nhận
    wsCommission.getColumn(9).width = 12;  // Hoa hồng
    wsCommission.getColumn(10).width = 5;  // Ảnh 3x4
    wsCommission.getColumn(11).width = 5;  // CCCD trước
    wsCommission.getColumn(12).width = 5;  // CCCD sau

    let commissionIdx = 1;
    for (const sd of allConsultants) {
      for (const d of (sd.commissionDetails || [])) {
        const row = wsCommission.addRow([
          commissionIdx++,
          sd.userName,
          `${d.courseCode} - ${d.courseName}`,
          d.learnerName,
          d.learnerPhone || '',
          d.learnerEmail || '',
          d.cccdNumber || '',
          new Date(d.registrationDate).toLocaleDateString('vi-VN'),
          d.commissionAmount,
          '',
          '',
          '',
        ]);
        row.height = 80;

        // Embed ảnh 3x4
        if (d.photo) {
          try {
            const imgResponse = await axios.get(d.photo, { responseType: 'arraybuffer' });
            const imgId = wb.addImage({
              base64: Buffer.from(imgResponse.data).toString('base64'),
              extension: 'jpeg',
            });
            wsCommission.addImage(imgId, {
              tl: { col: 9, row: row.number - 1 },
              ext: { width: 60, height: 80 },
            });
          } catch (err) {
            console.warn(`[buildAllSalaryExcel] Cannot load photo: ${d.photo}`);
          }
        }

        // Embed CCCD mặt trước
        if (d.cccdImageFront) {
          try {
            const imgResponse = await axios.get(d.cccdImageFront, { responseType: 'arraybuffer' });
            const imgId = wb.addImage({
              base64: Buffer.from(imgResponse.data).toString('base64'),
              extension: 'jpeg',
            });
            wsCommission.addImage(imgId, {
              tl: { col: 10, row: row.number - 1 },
              ext: { width: 60, height: 80 },
            });
          } catch (err) {
            console.warn(`[buildAllSalaryExcel] Cannot load cccdImageFront: ${d.cccdImageFront}`);
          }
        }

        // Embed CCCD mặt sau
        if (d.cccdImageBack) {
          try {
            const imgResponse = await axios.get(d.cccdImageBack, { responseType: 'arraybuffer' });
            const imgId = wb.addImage({
              base64: Buffer.from(imgResponse.data).toString('base64'),
              extension: 'jpeg',
            });
            wsCommission.addImage(imgId, {
              tl: { col: 11, row: row.number - 1 },
              ext: { width: 60, height: 80 },
            });
          } catch (err) {
            console.warn(`[buildAllSalaryExcel] Cannot load cccdImageBack: ${d.cccdImageBack}`);
          }
        }
      }
    }
  }

  // Sheet 4: Theo khóa học
  const wsCourse = wb.addWorksheet('Theo khóa học');
  wsCourse.addRow(['Khóa học', 'Số lượng']);
  wsCourse.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsCourse.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  const courseMap = {};
  allSalaryData.forEach((sd) => {
    (sd.courseCounts || []).forEach(cc => {
      const key = `${cc.courseCode} - ${cc.courseName}`;
      courseMap[key] = (courseMap[key] || 0) + cc.count;
    });
  });
  Object.entries(courseMap).forEach(([course, count]) => {
    wsCourse.addRow([course, count]);
  });
  wsCourse.getColumn(1).width = 30;
  wsCourse.getColumn(2).width = 12;

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
};

// ============================================
// API: Xuất file Excel tất cả lương tháng (Admin)
// ============================================
export const exportAllSalaryExcel = async (req, res) => {
  try {
    const { month, year, role, courseId } = req.query;

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    // Pre-fetch tất cả data
    const [config, allConfigs, courses, users, leaveConfig] = await Promise.all([
      getConfigForMonth(targetYear, targetMonth),
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
      User.find({ role: { $in: ['INSTRUCTOR', 'CONSULTANT'] } }).lean(),
      getLeaveConfigForYear(targetYear),
    ]);

    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs, penaltiesFromDb] = await Promise.all([
      Booking.find({
        instructorId: { $in: users.map(u => u._id) },
        date: { $gte: startDate, $lte: endDate },
      }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({
        consultantId: { $in: users.map(u => u._id) },
        isDeleted: false,
        createdAt: { $gte: startDate, $lte: endDate },
      }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
      Penalty.find({
        user: { $in: users.map(u => u._id) },
        date: { $gte: startDate, $lte: endDate },
      }).lean(),
    ]);

    // Group by user
    const bookingsByInstructor = {};
    allBookings.forEach(b => {
      const uid = b.instructorId?.toString();
      if (!uid) return;
      if (!bookingsByInstructor[uid]) bookingsByInstructor[uid] = [];
      bookingsByInstructor[uid].push(b);
    });

    const docsByConsultant = {};
    allDocs.forEach(d => {
      const uid = d.consultantId?.toString();
      if (!uid) return;
      if (!docsByConsultant[uid]) docsByConsultant[uid] = [];
      docsByConsultant[uid].push(d);
    });

    // Group penalties by userId for salary calculation
    const penaltiesByUserId = {};
    penaltiesFromDb.forEach(p => {
      const uid = p.user?.toString();
      if (!uid) return;
      if (!penaltiesByUserId[uid]) penaltiesByUserId[uid] = [];
      penaltiesByUserId[uid].push(p);
    });

    // Apply role filter
    let filteredUsers = users;
    if (role === 'INSTRUCTOR') filteredUsers = users.filter(u => u.role === 'INSTRUCTOR');
    if (role === 'CONSULTANT') filteredUsers = users.filter(u => u.role === 'CONSULTANT');

    // Tính lương từng user
    const allSalaryData = [];
    for (const user of filteredUsers) {
      const uid = user._id.toString();
      const salaryData = calculateSalaryWithSharedData(
        uid, targetMonth, targetYear,
        { courseIdFilter: courseId },
        allConfigs, courses, courseMap,
        bookingsByInstructor,
        docsByConsultant,
        config,
        user,
        leaveConfig,
        penaltiesByUserId
      );
      if (salaryData) {
        allSalaryData.push(salaryData);
      }
    }

    const excelBuffer = await buildAllSalaryExcel(allSalaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_tong_hop_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Xuất file Excel chi tiết lương
// ============================================
export const exportSalaryCSV = async (req, res) => {
  try {
    const { userId, month, year, courseId } = req.query;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId là bắt buộc' });
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    // Pre-fetch tất cả data (parallel)
    const [config, allConfigs, courses, user, leaveConfig] = await Promise.all([
      getConfigForMonth(targetYear, targetMonth),
      getAllConfigs(),
      Course.find({ status: 'Active' }).lean(),
      User.findById(userId).lean(),
      getLeaveConfigForYear(targetYear),
    ]);

    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    // Pre-fetch bookings & documents
    const [allBookings, allDocs, allPenalties] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
      Penalty.find({ user: userId, date: { $gte: startDate, $lte: endDate } }).lean(),
    ]);

    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear,
      { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig,
      { [userId]: allPenalties }
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const excelBuffer = await buildSalaryExcel(salaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_${salaryData.userName}_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};


// ============================================
// API: PENALTIES
// ============================================
export const getUserPenalties = async (req, res) => {
  try {
    const { id } = req.params;
    const { month, year } = req.query;

    let filter = { user: id };

    if (month && year) {
      const tMonth = parseInt(month);
      const tYear = parseInt(year);
      const startDate = new Date(tYear, tMonth - 1, 1);
      const endDate = new Date(tYear, tMonth, 0, 23, 59, 59);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const penalties = await Penalty.find(filter).sort({ date: -1 }).lean();
    res.json({ status: 'success', data: penalties });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const addPenalty = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, date } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Số tiền phạt không hợp lệ' });
    }
    if (amount > 10000000) {
      return res.status(400).json({ status: 'error', message: 'Số tiền phạt không được vượt quá 10.000.000 đ' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ status: 'error', message: 'Lý do nộp phạt là bắt buộc' });
    }

    // Validate penalty date: must be within past 30 days or current/next month
    const penaltyDate = date ? new Date(date) : new Date();
    const now = new Date();
    const maxFutureDate = new Date(now);
    maxFutureDate.setDate(maxFutureDate.getDate() + 30);
    if (penaltyDate < new Date(now.getFullYear() - 1, 0, 1)) {
      return res.status(400).json({ status: 'error', message: 'Ngày phạt không hợp lệ' });
    }

    const penalty = new Penalty({
      user: id,
      amount,
      reason,
      date: penaltyDate,
      createdBy: req.user?.id || req.userId
    });

    await penalty.save();

    res.json({ status: 'success', message: 'Thêm nộp phạt thành công', data: penalty });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deletePenalty = async (req, res) => {
  try {
    const { penaltyId } = req.params;
    const penalty = await Penalty.findByIdAndDelete(penaltyId);
    if (!penalty) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy nộp phạt' });
    }
    res.json({ status: 'success', message: 'Đã hủy nộp phạt' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
