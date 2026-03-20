import SalaryConfig from '../models/SalaryConfig.js';
import SalaryReport from '../models/SalaryReport.js';
import LeaveConfig from '../models/LeaveConfig.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Document from '../models/Document.js';
import * as XLSX from 'xlsx';

// ============================================
// HELPER: Lấy cấu hình lương hiện tại (so với ngày hiện tại)
// ============================================
const getActiveConfig = async () => {
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
const getConfigForMonth = async (year, month) => {
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
const getLeaveConfigForYear = async (year) => {
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
    if (!effectiveDate || effectiveDate <= docDate) {
      if (!bestEntry || (effectiveDate && (!bestEffDate || effectiveDate > bestEffDate))) {
        bestEntry = entry;
        bestEffDate = effectiveDate;
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
    : (config?.instructorHourlyRate || 80000);

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
        registrationDate: reg.firstPaymentDate || reg.createdAt || doc.createdAt,
        commissionAmount: commission
      });
    });
  }

  const teachingSalary = totalTeachingHours * hourlyRate;
  const totalSalary = teachingSalary + totalCommission;

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
          instructorHourlyRate: 80000,
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
      console.warn('[Salary] 400 createSalaryConfig: invalid hourlyRate', { instructorHourlyRate });
      return res.status(400).json({ status: 'error', message: 'Lương theo giờ không hợp lệ' });
    }

    if (!effectiveFrom) {
      console.warn('[Salary] 400 createSalaryConfig: missing effectiveFrom', { body: req.body });
      return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực là bắt buộc' });
    }

    const effectiveDate = new Date(effectiveFrom + 'T00:00:00');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (effectiveDate < todayStart) {
      console.warn('[Salary] 400 createSalaryConfig: past effectiveFrom', { effectiveFrom });
      return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực không được là ngày trong quá khứ' });
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

    if (courseCommissions) config.courseCommissions = courseCommissions;
    if (instructorHourlyRate) config.instructorHourlyRate = instructorHourlyRate;
    if (effectiveFrom) {
      const newEffDate = new Date(effectiveFrom + 'T00:00:00');
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (newEffDate < todayStart) {
        console.warn('[Salary] 400 updateSalaryConfig: past effectiveFrom', { effectiveFrom, id });
        return res.status(400).json({ status: 'error', message: 'Ngày hiệu lực không được là ngày trong quá khứ' });
      }
      config.effectiveFrom = newEffDate;
    }
    if (effectiveTo) config.effectiveTo = new Date(effectiveTo);
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
    console.log('[getCoursesForSalary] courses count:', courses.length, courses.map(c => c.code));
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
  const { allConfigs, courses, courseMap, bookingsByInstructor, docsByConsultant, config, courseIdFilter, leaveConfig } = sharedData;
  const results = [];

  for (const user of users) {
    const salaryData = calculateSalaryWithSharedData(
      user._id, targetMonth, targetYear, options,
      allConfigs, courses, courseMap, bookingsByInstructor, docsByConsultant, config,
      user, leaveConfig
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
  userObj, leaveConfig
) => {
  const user = userObj;
  if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
    return null;
  }

  const hourlyRate = Number.isFinite(user.salaryHourlyRate)
    ? user.salaryHourlyRate
    : (config?.instructorHourlyRate || 80000);

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
    console.log(`[Salary] CONSULTANT ${user.fullName}: raw docs=${rawDocs.length}`);
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
    console.log(`[Salary] CONSULTANT filtered docs=${docs.length} courseMap keys=${Object.keys(courseMap)}`);

    docs.forEach(doc => {
      const reg = doc.registrationId;
      const courseId = reg.courseId._id?.toString() || reg.courseId.toString();
      console.log(`[Salary] doc courseId=${courseId} inMap=${!!courseMap[courseId]}`);
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
        registrationDate: reg.firstPaymentDate || reg.createdAt || doc.createdAt,
        commissionAmount: commission
      });
    });
  }

  const teachingSalary = totalTeachingHours * hourlyRate;
  const totalSalaryBeforeDeduction = teachingSalary + totalCommission;

  // Compute leave deduction for INSTRUCTOR only
  const leaveDeduction = computeLeaveDeduction(user, leaveConfig, targetMonth, targetYear);
  const totalSalary = Math.max(0, totalSalaryBeforeDeduction - leaveDeduction);

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
  console.log('[Salary] getMonthlySummary called', req.query);
  try {
    const { month, year, role, search, courseId, page = 1, limit = 10 } = req.query;
    console.log(`[Salary] monthly-summary month=${month} year=${year} role=${role} courseId=${courseId} page=${page}`);

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

    console.log('[Salary DEBUG] config:', !!config, 'courses:', courses.length);
    if (!config) {
      console.warn('[Salary] 400 monthly-summary: no salary config', { query: req.query });
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

    const [allBookings, allDocs] = await Promise.all([
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
    };
    const allResults = await calculateSalaryBatch(allUsers, targetMonth, targetYear, { courseIdFilter: courseId }, sharedDataAll);
    const totalStats = {
      totalSalary: allResults.reduce((s, u) => s + (u.totalSalary || 0), 0),
      totalHours: allResults.reduce((s, u) => s + (u.totalTeachingHours || 0), 0),
      totalCommission: allResults.reduce((s, u) => s + (u.totalCommission || 0), 0),
      totalDocuments: allResults.reduce((s, u) => s + (u.totalDocuments || 0), 0),
      instructorCount: allResults.filter(u => u.role === 'INSTRUCTOR').length,
      consultantCount: allResults.filter(u => u.role === 'CONSULTANT').length,
    };

    // Tính results cho paginated users (dùng lại data đã pre-fetch ở trên)
    const paginatedIds = paginatedUsers.map(u => u._id.toString());
    const paginatedResults = allResults.filter(u => paginatedIds.includes(u.userId.toString()));

    console.log(`[Salary] total=${total} results=${paginatedResults.length}`);

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
    console.error('[Salary] monthly-summary ERROR:', error);
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
      console.warn('[Salary] 400: missing userId', { query: req.query });
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
      console.warn('[Salary] 400 getSalaryDetail: no config', { query: req.query });
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } })
        .populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false })
        .populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
    ]);

    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    await SalaryReport.findOneAndUpdate(
      { month: targetMonth, year: targetYear, userId },
      {
        month: targetMonth, year: targetYear, userId,
        role: salaryData.role,
        totalTeachingHours: salaryData.totalTeachingHours,
        totalTeachingSessions: salaryData.totalTeachingSessions,
        totalCommission: salaryData.totalCommission,
        totalSalary: salaryData.totalSalary,
        courseCounts: salaryData.courseCounts,
        teachingDetails: salaryData.teachingDetails,
        commissionDetails: salaryData.commissionDetails,
        configId: config._id,
        status: 'DRAFT',
        createdBy: req.userId
      },
      { upsert: true, new: true }
    );

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
      console.warn('[Salary] 400 getMySalary: no config', { userId, query: req.query });
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

    const [allBookings, allDocs] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } })
        .populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false })
        .populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
    ]);

    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig
    );

    await SalaryReport.findOneAndUpdate(
      { month: targetMonth, year: targetYear, userId },
      {
        month: targetMonth, year: targetYear, userId,
        role: salaryData.role,
        totalTeachingHours: salaryData.totalTeachingHours,
        totalTeachingSessions: salaryData.totalTeachingSessions,
        totalCommission: salaryData.totalCommission,
        totalSalary: salaryData.totalSalary,
        courseCounts: salaryData.courseCounts,
        teachingDetails: salaryData.teachingDetails,
        commissionDetails: salaryData.commissionDetails,
        configId: config._id,
        status: 'DRAFT',
        createdBy: req.userId
      },
      { upsert: true, new: true }
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
      console.warn('[Salary] 400 exportMySalaryCSV: no config', { userId, query: req.query });
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } })
        .populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false })
        .populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
    ]);

    const leaveConfig = await getLeaveConfigForYear(targetYear);
    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear, { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    const excelBuffer = buildSalaryExcel(salaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_${salaryData.userName}_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('[Salary] exportMySalaryCSV ERROR:', error);
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
      console.warn('[Salary] 400: invalid user role', { userId: id, role: user?.role });
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
      console.warn('[Salary] 400: invalid user role', { userId: id, role: user?.role });
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
      console.warn('[Salary] 400 updateLeaveConfig: invalid paidLeaveDaysPerYear', { paidLeaveDaysPerYear });
      return res.status(400).json({ status: 'error', message: 'Số ngày nghỉ phép không hợp lệ' });
    }
    if (leaveDeductionPerDay !== undefined && (leaveDeductionPerDay < 0 || !Number.isFinite(leaveDeductionPerDay))) {
      console.warn('[Salary] 400 updateLeaveConfig: invalid leaveDeductionPerDay', { leaveDeductionPerDay });
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
// HELPER: Tạo file Excel từ salary data
// ============================================
const buildSalaryExcel = (salaryData, targetMonth, targetYear) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tổng quan
  const overview = [
    ['BẢNG LƯƠNG THÁNG', `${targetMonth}/${targetYear}`],
    ['Họ tên', salaryData.userName],
    ['Vai trò', salaryData.role === 'INSTRUCTOR' ? 'Giảng viên' : 'Tư vấn viên'],
    [],
    ['TỔNG QUAN'],
    ['Tổng giờ dạy', salaryData.totalTeachingHours],
    ['Tổng số buổi', salaryData.totalTeachingSessions],
    ['Tổng hoa hồng', salaryData.totalCommission],
    ['Tổng lương', salaryData.totalSalary],
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overview);
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Tổng quan');

  // Sheet 2: Chi tiết giờ dạy (INSTRUCTOR)
  if (salaryData.teachingDetails && salaryData.teachingDetails.length > 0) {
    const teaching = [
      ['Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền'],
      ...salaryData.teachingDetails.map(d => [
        new Date(d.date).toLocaleDateString('vi-VN'),
        d.timeSlot,
        d.learnerName,
        d.hours,
        d.amount,
      ]),
    ];
    const wsTeaching = XLSX.utils.aoa_to_sheet(teaching);
    XLSX.utils.book_append_sheet(wb, wsTeaching, 'Chi tiết giờ dạy');
  }

  // Sheet 3: Chi tiết hoa hồng (CONSULTANT)
  if (salaryData.commissionDetails && salaryData.commissionDetails.length > 0) {
    const commission = [
      ['Khóa học', 'Tên học viên', 'Ngày nhận hồ sơ', 'Hoa hồng'],
      ...salaryData.commissionDetails.map(d => [
        `${d.courseCode} - ${d.courseName}`,
        d.learnerName,
        new Date(d.registrationDate).toLocaleDateString('vi-VN'),
        d.commissionAmount,
      ]),
    ];
    const wsCommission = XLSX.utils.aoa_to_sheet(commission);
    XLSX.utils.book_append_sheet(wb, wsCommission, 'Chi tiết hoa hồng');
  }

  // Sheet 4: Tổng hợp theo khóa học
  if (salaryData.courseCounts && salaryData.courseCounts.length > 0) {
    const courseSummary = [
      ['Khóa học', 'Số lượng'],
      ...salaryData.courseCounts.map(cc => [
        `${cc.courseCode} - ${cc.courseName}`,
        cc.count,
      ]),
    ];
    const wsCourse = XLSX.utils.aoa_to_sheet(courseSummary);
    XLSX.utils.book_append_sheet(wb, wsCourse, 'Theo khóa học');
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
};

// ============================================
// HELPER: Build Excel tất cả lương (nhiều user)
// ============================================
const buildAllSalaryExcel = (allSalaryData, targetMonth, targetYear) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Tổng hợp
  const summary = [
    ['BẢNG LƯƠNG THÁNG', `${targetMonth}/${targetYear}`],
    ['Ngày xuất', new Date().toLocaleString('vi-VN')],
    ['Tổng nhân viên', allSalaryData.length],
    [],
    ['STT', 'Họ tên', 'Vai trò', 'Tổng giờ dạy', 'Tổng số buổi', 'Hoa hồng', 'Tổng lương'],
  ];
  allSalaryData.forEach((sd, idx) => {
    summary.push([
      idx + 1,
      sd.userName,
      sd.role === 'INSTRUCTOR' ? 'Giảng viên' : 'Tư vấn viên',
      sd.totalTeachingHours,
      sd.totalTeachingSessions,
      sd.totalCommission,
      sd.totalSalary,
    ]);
  });
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tổng hợp');

  // Sheet 2: Chi tiết giờ dạy (tất cả instructor)
  const teachingRows = [['STT', 'Họ tên GV', 'Ngày', 'Ca', 'Học viên', 'Số giờ', 'Số tiền']];
  allSalaryData.filter(sd => sd.role === 'INSTRUCTOR').forEach((sd) => {
    (sd.teachingDetails || []).forEach(d => {
      teachingRows.push([
        teachingRows.length,
        sd.userName,
        new Date(d.date).toLocaleDateString('vi-VN'),
        d.timeSlot,
        d.learnerName,
        d.hours,
        d.amount,
      ]);
    });
  });
  const wsTeaching = XLSX.utils.aoa_to_sheet(teachingRows);
  XLSX.utils.book_append_sheet(wb, wsTeaching, 'Chi tiết giờ dạy');

  // Sheet 3: Chi tiết hoa hồng (tất cả consultant)
  const commissionRows = [['STT', 'Họ tên TV', 'Khóa học', 'Học viên', 'Ngày nhận', 'Hoa hồng']];
  allSalaryData.filter(sd => sd.role === 'CONSULTANT').forEach((sd) => {
    (sd.commissionDetails || []).forEach(d => {
      commissionRows.push([
        commissionRows.length,
        sd.userName,
        `${d.courseCode} - ${d.courseName}`,
        d.learnerName,
        new Date(d.registrationDate).toLocaleDateString('vi-VN'),
        d.commissionAmount,
      ]);
    });
  });
  const wsCommission = XLSX.utils.aoa_to_sheet(commissionRows);
  XLSX.utils.book_append_sheet(wb, wsCommission, 'Chi tiết hoa hồng');

  // Sheet 4: Theo khóa học
  const courseRows = [['Khóa học', 'Số lượng']];
  const courseMap = {};
  allSalaryData.forEach((sd) => {
    (sd.courseCounts || []).forEach(cc => {
      const key = `${cc.courseCode} - ${cc.courseName}`;
      courseMap[key] = (courseMap[key] || 0) + cc.count;
    });
  });
  Object.entries(courseMap).forEach(([course, count]) => {
    courseRows.push([course, count]);
  });
  const wsCourse = XLSX.utils.aoa_to_sheet(courseRows);
  XLSX.utils.book_append_sheet(wb, wsCourse, 'Theo khóa học');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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
      console.warn('[Salary] 400 exportAllSalaryExcel: no config', { query: req.query });
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const courseMap = {};
    courses.forEach(c => { courseMap[c._id.toString()] = { code: c.code, name: c.name }; });

    const startDate = new Date(targetYear, targetMonth - 1, 1);
    const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

    const [allBookings, allDocs] = await Promise.all([
      Booking.find({
        instructorId: { $in: users.map(u => u._id) },
        date: { $gte: startDate, $lte: endDate },
      }).populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({
        consultantId: { $in: users.map(u => u._id) },
        isDeleted: false,
      }).populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
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
        leaveConfig
      );
      if (salaryData) {
        allSalaryData.push(salaryData);
      }
    }

    const excelBuffer = buildAllSalaryExcel(allSalaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_tong_hop_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('[Salary] exportAllSalaryExcel ERROR:', error);
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
      console.warn('[Salary] 400: missing userId', { query: req.query });
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
      console.warn('[Salary] 400 exportSalaryCSV: no config', { query: req.query });
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
    const [allBookings, allDocs] = await Promise.all([
      Booking.find({ instructorId: userId, date: { $gte: startDate, $lte: endDate } })
        .populate('learnerId', 'fullName').populate('batchId', 'courseId').lean(),
      Document.find({ consultantId: userId, isDeleted: false })
        .populate({ path: 'registrationId', populate: { path: 'courseId learnerId' } }).lean(),
    ]);

    const salaryData = calculateSalaryWithSharedData(
      userId, targetMonth, targetYear,
      { courseIdFilter: courseId },
      allConfigs, courses, courseMap,
      { [userId]: allBookings },
      { [userId]: allDocs },
      config,
      user,
      leaveConfig
    );

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

    // Upsert SalaryReport
    await SalaryReport.findOneAndUpdate(
      { month: targetMonth, year: targetYear, userId },
      {
        month: targetMonth,
        year: targetYear,
        userId,
        role: salaryData.role,
        totalTeachingHours: salaryData.totalTeachingHours,
        totalTeachingSessions: salaryData.totalTeachingSessions,
        totalCommission: salaryData.totalCommission,
        totalSalary: salaryData.totalSalary,
        courseCounts: salaryData.courseCounts,
        teachingDetails: salaryData.teachingDetails,
        commissionDetails: salaryData.commissionDetails,
        configId: config._id,
        status: 'DRAFT',
        createdBy: req.userId
      },
      { upsert: true, new: true }
    );

    const excelBuffer = buildSalaryExcel(salaryData, targetMonth, targetYear);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`luong_${salaryData.userName}_${targetMonth}_${targetYear}.xlsx`)}`);
    res.send(excelBuffer);
  } catch (error) {
    console.error('[Salary] Export Excel ERROR:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};
