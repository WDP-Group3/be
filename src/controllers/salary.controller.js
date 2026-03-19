import SalaryConfig from '../models/SalaryConfig.js';
import SalaryReport from '../models/SalaryReport.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Document from '../models/Document.js';

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
      commissionAmount: cc.commissionAmount
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
    if (effectiveFrom) config.effectiveFrom = new Date(effectiveFrom);
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
    res.json({
      status: 'success',
      data: courses
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ============================================
// API: Lấy tổng lương tháng (Admin) - GET
// ============================================
export const getMonthlySummary = async (req, res) => {
  try {
    const { month, year, role, search, courseId, page = 1, limit = 10 } = req.query;

    // Mặc định: tháng trước
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Tính tháng trước
    let prevMonth = currentMonth - 1;
    let prevYear = currentYear;
    if (prevMonth < 1) { prevMonth = 12; prevYear = currentYear - 1; }

    const targetMonth = month ? parseInt(month) : prevMonth;
    const targetYear = year ? parseInt(year) : prevYear;

    // Lấy users theo role
    const userFilter = { role: { $in: ['INSTRUCTOR', 'CONSULTANT'] }, status: 'ACTIVE' };
    if (role) {
      userFilter.role = role;
    }
    if (search) {
      userFilter.fullName = { $regex: search, $options: 'i' };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(userFilter);
    const users = await User.find(userFilter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ fullName: 1 })
      .lean();

    // Lấy cấu hình lương áp dụng cho tháng này
    const config = await getConfigForMonth(targetYear, targetMonth);
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương. Vui lòng cấu hình trước.'
      });
    }

    // Tính lương cho từng user
    const results = [];

    for (const user of users) {
      const salaryData = await calculateSalary(user._id, targetMonth, targetYear, { courseIdFilter: courseId });

      if (salaryData) {
        // Format course counts
        const courseCountMap = {};
        salaryData.courseCounts.forEach(cc => {
          courseCountMap[cc.courseCode] = cc.count;
        });

        if (courseId && user.role === 'CONSULTANT') {
          const matchedCourse = salaryData.courseCounts.find(cc => cc.courseId?.toString() === courseId.toString());
          if (!matchedCourse) {
            continue;
          }
        }

        // Kiểm tra override
        const hasOverride = (
          Number.isFinite(user.salaryHourlyRate) ||
          (Array.isArray(user.commissionOverrides) && user.commissionOverrides.length > 0)
        );

        results.push({
          _id: user._id,
          fullName: user.fullName,
          role: user.role,
          hourlyRate: salaryData.hourlyRate,
          teachingSalary: salaryData.teachingSalary,
          totalTeachingHours: salaryData.totalTeachingHours,
          totalTeachingSessions: salaryData.totalTeachingSessions,
          totalCommission: salaryData.totalCommission,
          totalDocuments: salaryData.totalDocuments,
          totalSalary: salaryData.totalSalary,
          courseCounts: courseCountMap,
          hasOverride,
          salaryData: salaryData
        });
      }
    }

    res.json({
      status: 'success',
      data: {
        users: results,
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
        }
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

    const config = await getConfigForMonth(targetYear, targetMonth);
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương'
      });
    }

    const salaryData = await calculateSalary(userId, targetMonth, targetYear, { courseIdFilter: courseId });

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

    res.json({
      status: 'success',
      data: salaryData
    });
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
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương'
      });
    }

    const salaryData = await calculateSalary(userId, targetMonth, targetYear, { courseIdFilter: courseId });

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

    res.json({
      status: 'success',
      data: {
        ...salaryData,
        filter: {
          month: targetMonth,
          year: targetYear,
          courseId
        }
      }
    });
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
// API: Xuất file CSV chi tiết lương
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

    const config = await getConfigForMonth(targetYear, targetMonth);
    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const salaryData = await calculateSalary(userId, targetMonth, targetYear, { courseIdFilter: courseId });

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

    // Tạo CSV
    let csv = '';

    // Header thông tin
    csv += `BẢNG LƯƠNG THÁNG ${targetMonth}/${targetYear}\n`;
    csv += `Họ tên: ${salaryData.userName}\n`;
    csv += `Vai trò: ${salaryData.role}\n`;
    csv += `\n`;

    // Tổng quan
    csv += `TỔNG QUAN\n`;
    csv += `Tổng giờ dạy,${salaryData.totalTeachingHours}\n`;
    csv += `Tổng số buổi,${salaryData.totalTeachingSessions}\n`;
    csv += `Tổng hoa hồng,${salaryData.totalCommission}\n`;
    csv += `Tổng lương,${salaryData.totalSalary}\n`;
    csv += `\n`;

    // Chi tiết giờ dạy (INSTRUCTOR)
    if (salaryData.teachingDetails.length > 0) {
      csv += `CHI TIẾT GIỜ DẠY\n`;
      csv += `Ngày,Ca,Học viên,Số giờ,Số tiền\n`;
      salaryData.teachingDetails.forEach(d => {
        const date = new Date(d.date).toLocaleDateString('vi-VN');
        csv += `${date},${d.timeSlot},${d.learnerName},${d.hours},${d.amount}\n`;
      });
      csv += `\n`;
    }

    // Chi tiết hoa hồng
    if (salaryData.commissionDetails.length > 0) {
      csv += `CHI TIẾT HOA HỒNG\n`;
      csv += `Khóa học,Tên học viên,Ngày nhận hồ sơ,Hoa hồng\n`;
      salaryData.commissionDetails.forEach(d => {
        const date = new Date(d.registrationDate).toLocaleDateString('vi-VN');
        csv += `${d.courseCode} - ${d.courseName},${d.learnerName},${date},${d.commissionAmount}\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=salary_${salaryData.userName}_${targetMonth}_${targetYear}.csv`);
    res.send('\ufeff' + csv); // BOM for UTF-8
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
