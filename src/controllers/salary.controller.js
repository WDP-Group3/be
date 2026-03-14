import mongoose from 'mongoose';
import SalaryConfig from '../models/SalaryConfig.js';
import SalaryReport from '../models/SalaryReport.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Registration from '../models/Registration.js';
import Document from '../models/Document.js';

// ============================================
// HELPER: Lấy cấu hình lương hiện tại
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
// HELPER: Tính lương cho một user trong tháng
// ============================================
const calculateSalary = async (userId, month, year, config) => {
  const user = await User.findById(userId);
  if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
    return null;
  }

  // Lấy danh sách courses
  const courses = await Course.find({ status: 'Active' }).lean();
  const courseMap = {};
  courses.forEach(c => {
    courseMap[c._id.toString()] = { code: c.code, name: c.name };
  });

  // Map commission theo courseId
  const commissionMap = {};
  config.courseCommissions.forEach(cc => {
    commissionMap[cc.courseId.toString()] = cc.commissionAmount;
  });

  const hourlyRate = config.instructorHourlyRate || 80000;

  // Tính ngày bắt đầu và kết thúc của tháng
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  let totalTeachingHours = 0;
  let totalTeachingSessions = 0;
  let totalCommission = 0;
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
    }).populate('studentId', 'fullName').lean();

    totalTeachingSessions = bookings.length;
    totalTeachingHours = bookings.length; // Mỗi buổi = 1 giờ

    bookings.forEach(booking => {
      teachingDetails.push({
        date: booking.date,
        timeSlot: booking.timeSlot,
        studentName: booking.studentId?.fullName || 'N/A',
        hours: 1,
        amount: hourlyRate
      });
    });
  }

  // === CONSULTANT: Tính hoa hồng hồ sơ ===
  // Mỗi hồ sơ (Document có consultantId) được gán cho consultant sẽ được tính hoa hồng
  // Ngày ghi nhận = createdAt của Document
  if (user.role === 'CONSULTANT') {
    const docs = await Document.find({
      consultantId: userId,
      isDeleted: false
    }).populate({
      path: 'registrationId',
      populate: { path: 'courseId studentId' }
    }).lean();

    // Lọc documents trong tháng (dựa vào createdAt của document)
    // Hoặc nếu document không có createdAt, dùng createdAt của registration
    const docsInMonth = docs.filter(doc => {
      const docDate = doc.createdAt ? new Date(doc.createdAt) : null;
      const regDate = doc.registrationId?.createdAt ? new Date(doc.registrationId.createdAt) : null;
      const targetDate = docDate || regDate;
      return targetDate && targetDate >= startDate && targetDate <= endDate;
    });

    // Thống kê theo course
    const processDocument = (doc) => {
      const reg = doc.registrationId;
      if (!reg) return;

      const courseId = reg.courseId?._id?.toString() || reg.courseId?.toString();
      if (!courseId) return;

      if (!courseCounts[courseId]) {
        courseCounts[courseId] = {
          courseId: reg.courseId?._id || reg.courseId,
          courseCode: courseMap[courseId]?.code || 'N/A',
          courseName: courseMap[courseId]?.name || 'N/A',
          count: 0
        };
      }
      courseCounts[courseId].count++;

      const commission = commissionMap[courseId] || 0;
      totalCommission += commission;

      commissionDetails.push({
        courseCode: courseMap[courseId]?.code || 'N/A',
        courseName: courseMap[courseId]?.name || 'N/A',
        studentName: reg.studentId?.fullName || 'N/A',
        registrationDate: reg.firstPaymentDate || reg.createdAt || doc.createdAt,
        commissionAmount: commission
      });
    };

    // Xử lý documents trong tháng
    docsInMonth.forEach(doc => processDocument(doc));
  }

  // Tính tổng lương
  const teachingSalary = totalTeachingHours * hourlyRate;
  const totalSalary = teachingSalary + totalCommission;

  return {
    userId,
    role: user.role,
    userName: user.fullName,
    totalTeachingHours,
    totalTeachingSessions,
    totalCommission,
    totalSalary,
    courseCounts: Object.values(courseCounts),
    teachingDetails,
    commissionDetails,
    configId: config._id
  };
};

// ============================================
// API: Lấy cấu hình lương hiện tại (GET)
// ============================================
export const getSalaryConfig = async (req, res) => {
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
    const { courseCommissions, instructorHourlyRate, effectiveFrom, note } = req.body;

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
export const getAllSalaryConfigs = async (req, res) => {
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
export const getCoursesForSalary = async (req, res) => {
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
    const { month, year, role, search, page = 1, limit = 10 } = req.query;

    // Mặc định: tháng trước
    const now = new Date();
    const currentMonth = month ? parseInt(month) : now.getMonth(); // 0-11
    const currentYear = year ? parseInt(year) : now.getFullYear();

    // Tính tháng trước nếu không truyền month
    let targetMonth = currentMonth;
    let targetYear = currentYear;

    if (!month) {
      targetMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      targetYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    }

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

    // Lấy cấu hình lương
    const config = await getActiveConfig();
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương. Vui lòng cấu hình trước.'
      });
    }

    // Map commission theo courseId
    const commissionMap = {};
    config.courseCommissions.forEach(cc => {
      commissionMap[cc.courseId.toString()] = cc.commissionAmount;
    });

    // Tính lương cho từng user
    const results = [];
    const courses = await Course.find({ status: 'Active' }).lean();

    for (const user of users) {
      const salaryData = await calculateSalary(user._id, targetMonth + 1, targetYear, config);

      if (salaryData) {
        // Format course counts
        const courseCountMap = {};
        salaryData.courseCounts.forEach(cc => {
          courseCountMap[cc.courseCode] = cc.count;
        });

        results.push({
          _id: user._id,
          fullName: user.fullName,
          role: user.role,
          totalTeachingHours: salaryData.totalTeachingHours,
          totalTeachingSessions: salaryData.totalTeachingSessions,
          totalCommission: salaryData.totalCommission,
          totalSalary: salaryData.totalSalary,
          courseCounts: courseCountMap,
          salaryData: salaryData // Giữ lại để dùng cho export
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
          month: targetMonth + 1,
          year: targetYear,
          role
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
    const { userId, month, year } = req.query;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId là bắt buộc' });
    }

    const now = new Date();
    const currentMonth = month ? parseInt(month) : now.getMonth();
    const currentYear = year ? parseInt(year) : now.getFullYear();

    // Tính tháng trước nếu không truyền month
    let targetMonth = currentMonth;
    let targetYear = currentYear;

    if (!month) {
      targetMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      targetYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    }

    const config = await getActiveConfig();
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương'
      });
    }

    const salaryData = await calculateSalary(userId, targetMonth + 1, targetYear, config);

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

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
    const { month, year } = req.query;

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Chưa đăng nhập' });
    }

    const user = await User.findById(userId);
    if (!user || !['INSTRUCTOR', 'CONSULTANT'].includes(user.role)) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem lương' });
    }

    const now = new Date();
    const currentMonth = month ? parseInt(month) : now.getMonth();
    const currentYear = year ? parseInt(year) : now.getFullYear();

    // Tính tháng trước nếu không truyền month
    let targetMonth = currentMonth;
    let targetYear = currentYear;

    if (!month) {
      targetMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      targetYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    }

    const config = await getActiveConfig();
    if (!config) {
      return res.status(400).json({
        status: 'error',
        message: 'Chưa có cấu hình lương'
      });
    }

    const salaryData = await calculateSalary(userId, targetMonth + 1, targetYear, config);

    res.json({
      status: 'success',
      data: {
        ...salaryData,
        filter: {
          month: targetMonth + 1,
          year: targetYear
        }
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
    const { userId, month, year } = req.query;

    if (!userId) {
      return res.status(400).json({ status: 'error', message: 'userId là bắt buộc' });
    }

    const now = new Date();
    const targetMonth = month ? parseInt(month) : (now.getMonth() === 0 ? 11 : now.getMonth());
    const targetYear = year ? parseInt(year) : (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

    const config = await getActiveConfig();
    if (!config) {
      return res.status(400).json({ status: 'error', message: 'Chưa có cấu hình lương' });
    }

    const salaryData = await calculateSalary(userId, targetMonth, targetYear, config);

    if (!salaryData) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy dữ liệu lương' });
    }

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
        csv += `${date},${d.timeSlot},${d.studentName},${d.hours},${d.amount}\n`;
      });
      csv += `\n`;
    }

    // Chi tiết hoa hồng
    if (salaryData.commissionDetails.length > 0) {
      csv += `CHI TIẾT HOA HỒNG\n`;
      csv += `Khóa học,Tên học viên,Ngày nhận hồ sơ,Hoa hồng\n`;
      salaryData.commissionDetails.forEach(d => {
        const date = new Date(d.registrationDate).toLocaleDateString('vi-VN');
        csv += `${d.courseCode} - ${d.courseName},${d.studentName},${date},${d.commissionAmount}\n`;
      });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=salary_${salaryData.userName}_${targetMonth}_${targetYear}.csv`);
    res.send('\ufeff' + csv); // BOM for UTF-8
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
