import Schedule from '../models/Schedule.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import SystemHoliday from '../models/SystemHoliday.js';
import Request from '../models/Request.js';
import { sendNotificationEmail } from '../services/email.service.js';
import { emitScheduleUpdate } from '../services/socket.service.js';

// [HELPER] Kiểm tra ngày có trong lịch nghỉ không - CHỈ áp dụng nếu nghỉ toàn hệ thống HOẶC trùng khu vực GV
// instructorLocation: khu vực dạy của GV (vd: Trung Giã). Nếu holiday.location = Thanh Xuân thì GV Trung Giã KHÔNG bị chặn.
const checkIsHoliday = async (date, instructorLocation = null) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  // Chỉ lấy lịch nghỉ áp dụng cho GV: toàn hệ thống (location null) HOẶC đúng khu vực GV
  const baseFilter = {
    startDate: { $lte: targetDate },
    endDate: { $gte: targetDate },
    isActive: true
  };
  if (instructorLocation && String(instructorLocation).trim()) {
    const locRegex = new RegExp(`^${String(instructorLocation).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const holiday = await SystemHoliday.findOne({
      ...baseFilter,
      $or: [
        { location: null },
        { location: { $regex: locRegex } }
      ]
    });
    return holiday;
  }
  const holiday = await SystemHoliday.findOne({ ...baseFilter, location: null });
  return holiday;
};

// [HELPER] Lấy danh sách ca học hợp lệ (7h-18h, mỗi ca 1 tiếng, nghỉ trưa 12h-13h)
// Ca học: 1(7-8), 2(8-9), 3(9-10), 4(10-11), 5(11-12), 6(13-14), 7(14-15), 8(15-16), 9(16-17), 10(17-18)
// Nghỉ trưa: 12h-13h (không có ca 5.5, chỉ có ca 5 đến 11h, ca 6 bắt đầu 13h)
const VALID_TIME_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// [HELPER] Lấy danh sách ngày nghỉ lễ trong khoảng thời gian
// location: null/undefined = lấy tất cả; có giá trị = chỉ lấy nghỉ toàn hệ thống + nghỉ của khu vực đó
const getHolidaysInRange = async (startDate, endDate, location = null) => {
  const baseFilter = {
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
    isActive: true
  };
  let filter = baseFilter;
  if (location && location.trim()) {
    const locRegex = new RegExp(`^${String(location).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    filter = {
      ...baseFilter,
      $or: [
        { location: null },
        { location: { $regex: locRegex } }
      ]
    };
  }
  const holidays = await SystemHoliday.find(filter).lean();
  return holidays;
};

// [HELPER] Tạo danh sách các slot nghỉ lễ từ ngày bắt đầu đến ngày kết thúc
const generateHolidaySlots = (holidays) => {
  const slots = [];
  const allTimeSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  
  for (const holiday of holidays) {
    const start = new Date(holiday.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(holiday.endDate);
    end.setHours(23, 59, 59, 999);
    
    // Duyệt qua từng ngày trong khoảng nghỉ lễ
    const current = new Date(start);
    while (current <= end) {
      // Thêm tất cả các ca học trong ngày làm slot nghỉ lễ
      for (const slot of allTimeSlots) {
        slots.push({
          date: new Date(current),
          timeSlot: slot,
          type: 'HOLIDAY',
          title: holiday.title,
          description: holiday.description,
          instructorId: null, // Không thuộc về instructor cụ thể
          category: 'HOLIDAY'
        });
      }
      current.setDate(current.getDate() + 1);
    }
  }
  return slots;
};

// [HELPER] Lấy tháng hiện tại format "YYYY-MM"
const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// [HELPER] Lấy thứ trong tuần (1 = Thứ 2, 7 = Chủ nhật)
const getDayOfWeek = (date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day; // Chuyển 0 (CN) thành 7
};

// [HELPER] Lấy ngày đầu tuần (Thứ 2) của một ngày
const getMonday = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

// [HELPER] Lấy ngày cuối tuần (Chủ nhật) của một ngày
const getSunday = (date) => {
  const d = getMonday(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
};

// [HELPER] Kiểm tra và cập nhật số lần nghỉ phép khẩn cấp
const checkEmergencyLeaveLimit = async (instructorId) => {
  const currentMonth = getCurrentMonth();
  let user = await User.findById(instructorId);
  
  // Nếu là tháng mới -> reset counter
  if (user.lastEmergencyLeaveMonth !== currentMonth) {
    user.emergencyLeaveCount = 0;
    user.lastEmergencyLeaveMonth = currentMonth;
    await user.save();
  }
  
  return {
    count: user.emergencyLeaveCount,
    remaining: Math.max(0, 2 - user.emergencyLeaveCount),
    canEmergency: user.emergencyLeaveCount < 2
  };
};

// [HELPER] Tăng số lần nghỉ phép khẩn cấp
const incrementEmergencyLeave = async (instructorId) => {
  const currentMonth = getCurrentMonth();
  const user = await User.findById(instructorId);
  
  if (user.lastEmergencyLeaveMonth !== currentMonth) {
    user.emergencyLeaveCount = 1;
    user.lastEmergencyLeaveMonth = currentMonth;
  } else {
    user.emergencyLeaveCount += 1;
  }
  await user.save();
};

// [HELPER] Gửi email thông báo khi có lịch bận khẩn cấp trùng với booking
const sendEmergencyBusyNotification = async (instructor, booking) => {
  const classDateStr = new Date(booking.date).toLocaleDateString('vi-VN', {
    weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric'
  });
  
  const SLOT_LABELS = {
    "1": "Ca 1 (07:00 - 08:00)",
    "2": "Ca 2 (08:00 - 09:00)",
    "3": "Ca 3 (09:00 - 10:00)",
    "4": "Ca 4 (10:00 - 11:00)",
    "5": "Ca 5 (11:00 - 12:00)",
    "6": "Ca 6 (13:00 - 14:00)",
    "7": "Ca 7 (14:00 - 15:00)",
    "8": "Ca 8 (15:00 - 16:00)",
    "9": "Ca 9 (16:00 - 17:00)",
    "10": "Ca 10 (17:00 - 18:00)",
  };

  const slotLabel = SLOT_LABELS[String(booking.timeSlot)] || `Ca ${booking.timeSlot}`;

  // Gửi email cho Giáo viên
  if (instructor.email) {
    const titleGV = '⚠️ Thông báo: Bạn đã báo bận khẩn cấp vào ngày có học viên đặt lịch';
    const messageGV = `Kính gửi Thầy/Cô ${instructor.fullName},

Thầy/Cô đã báo bận khẩn cấp vào ngày ${classDateStr} ${slotLabel}.

⚠️ LƯU Ý: Có học viên đã đặt lịch học vào thời gian này:
- Học viên: ${booking.learnerId?.fullName || 'N/A'}
- SĐT: ${booking.learnerId?.phone || 'N/A'}

Vui lòng liên hệ học viên hoặc admin để sắp xếp lịch học bù.

Trân trọng!`;
    
    try {
      await sendNotificationEmail(instructor.email, titleGV, messageGV);
      console.log(`✅ [EMERGENCY] Đã gửi email cho GV: ${instructor.email}`);
    } catch (error) {
      console.error(`❌ [EMERGENCY] Lỗi gửi email cho GV:`, error.message);
    }
  }

  // Gửi email cho Học viên
  if (booking.learnerId?.email) {
    const titleHV = '⚠️ Thông báo: Giáo viên đã báo bận khẩn cấp';
    const messageHV = `Kính gửi Học viên ${booking.learnerId.fullName},

Giáo viên ${instructor.fullName} đã báo bận khẩn cấp vào ngày ${classDateStr} ${slotLabel}.

⚠️ Buổi học của bạn có thể bị ảnh hưởng. Vui lòng liên hệ giáo viên hoặc admin để được sắp xếp lịch học bù.

Thông tin liên hệ:
- Giáo viên: ${instructor.fullName}
- SĐT: ${instructor.phone || 'N/A'}

Trân trọng!`;
    
    try {
      await sendNotificationEmail(booking.learnerId.email, titleHV, messageHV);
      console.log(`✅ [EMERGENCY] Đã gửi email cho HV: ${booking.learnerId.email}`);
    } catch (error) {
      console.error(`❌ [EMERGENCY] Lỗi gửi email cho HV:`, error.message);
    }
  }
};

// [MỚI] Gửi email thông báo huỷ booking do báo bận khẩn cấp
const sendBookingCancelledNotification = async (instructor, booking) => {
  const classDateStr = new Date(booking.date).toLocaleDateString('vi-VN', {
    weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric'
  });
  
  const SLOT_LABELS = {
    "1": "Ca 1 (07:00 - 08:00)",
    "2": "Ca 2 (08:00 - 09:00)",
    "3": "Ca 3 (09:00 - 10:00)",
    "4": "Ca 4 (10:00 - 11:00)",
    "5": "Ca 5 (11:00 - 12:00)",
    "6": "Ca 6 (13:00 - 14:00)",
    "7": "Ca 7 (14:00 - 15:00)",
    "8": "Ca 8 (15:00 - 16:00)",
    "9": "Ca 9 (16:00 - 17:00)",
    "10": "Ca 10 (17:00 - 18:00)",
  };

  const slotLabel = SLOT_LABELS[String(booking.timeSlot)] || `Ca ${booking.timeSlot}`;

  // Gửi email cho Giáo viên
  if (instructor.email) {
    const titleGV = '🔔 Thông báo: Đã huỷ lịch học do báo bận khẩn cấp';
    const messageGV = `Kính gửi Thầy/Cô ${instructor.fullName},

Thầy/Cô đã báo bận khẩn cấp vào ngày ${classDateStr} ${slotLabel}.

Hệ thống đã tự động huỷ lịch học của học viên:
- Học viên: ${booking.learnerId?.fullName || 'N/A'}
- SĐT: ${booking.learnerId?.phone || 'N/A'}
- Email: ${booking.learnerId?.email || 'N/A'}

📊 Thông tin nghỉ phép khẩn cấp:
- Số lần đã sử dụng: Đã được cập nhật
- Số lần còn lại trong tháng: Sẽ được cập nhật sau khi refresh trang

Vui lòng liên hệ học viên để sắp xếp lịch học bù nếu cần.

Trân trọng!`;
    
    try {
      await sendNotificationEmail(instructor.email, titleGV, messageGV);
      console.log(`✅ [CANCELLED] Đã gửi email huỷ cho GV: ${instructor.email}`);
    } catch (error) {
      console.error(`❌ [CANCELLED] Lỗi gửi email cho GV:`, error.message);
    }
  }

  // Gửi email cho Học viên
  if (booking.learnerId?.email) {
    const titleHV = '🔔 Thông báo: Lịch học đã bị huỷ do giáo viên báo bận khẩn cấp';
    const messageHV = `Kính gửi Học viên ${booking.learnerId.fullName},

Rất tiếc, lịch học của bạn đã bị huỷ do giáo viên ${instructor.fullName} báo bận khẩn cấp.

📋 Thông tin lịch học bị huỷ:
- Ngày: ${classDateStr}
- Ca: ${slotLabel}
- Lý do huỷ: Giáo viên báo bận khẩn cấp

📞 Vui lòng liên hệ giáo viên hoặc admin để đặt lịch học bù:

Thông tin liên hệ:
- Giáo viên: ${instructor.fullName}
- SĐT: ${instructor.phone || 'N/A'}
- Email: ${instructor.email || 'N/A'}

Chúng tôi rất tiếc về sự bất tiện này!

Trân trọng!`;
    
    try {
      await sendNotificationEmail(booking.learnerId.email, titleHV, messageHV);
      console.log(`✅ [CANCELLED] Đã gửi email huỷ cho HV: ${booking.learnerId.email}`);
    } catch (error) {
      console.error(`❌ [CANCELLED] Lỗi gửi email cho HV:`, error.message);
    }
  }
};

// [HELPER] Lấy số lần nghỉ phép khẩn cấp còn lại
export const getEmergencyLeaveInfo = async (req, res) => {
  try {
    const instructorId = req.userId;
    const user = await User.findById(instructorId);
    
    const currentMonth = getCurrentMonth();
    
    // Reset nếu sang tháng mới
    if (user.lastEmergencyLeaveMonth !== currentMonth) {
      user.emergencyLeaveCount = 0;
      user.lastEmergencyLeaveMonth = currentMonth;
      await user.save();
    }
    
    res.json({
      status: 'success',
      data: {
        currentMonth,
        usedCount: user.emergencyLeaveCount,
        remainingCount: Math.max(0, 2 - user.emergencyLeaveCount),
        maxPerMonth: 2
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// [HELPER] Kiểm tra hạn chót Thứ 6 (18:00) cho việc đăng ký tuần sau
// QUY TẮC MỚI:
// 1. Báo bận TRONG tuần hiện tại → KHẨN CẤP
// 2. Báo bận cho tuần sau:
//    - Nếu hôm nay là Thứ 7 hoặc CN → KHẨN CẤP (vì đã qua deadline)
//    - Nếu hôm nay là Thứ 2-5 và trước 18h Thứ 6 → BÌNH THƯỜNG
//    - Nếu hôm nay là Thứ 6 sau 18h hoặc Thứ 7-CN → KHẨN CẤP
// 3. Ngày báo bận là Thứ 7 hoặc CN → KHẨN CẤP
const checkInstructorDeadline = (targetDateStr) => {
  const now = new Date();
  const targetDate = new Date(targetDateStr);
  
  // Reset targetDate to start of day to avoid time issues
  targetDate.setHours(0, 0, 0, 0);
  
  // Lấy Thứ 2 và Chủ nhật của tuần HIỆN TẠI
  const thisWeekMonday = getMonday(now);
  const thisWeekSunday = getSunday(now);
  
  // Lấy Thứ 2 và Chủ nhật của tuần SAU
  const nextWeekMonday = new Date(thisWeekMonday);
  nextWeekMonday.setDate(nextWeekMonday.getDate() + 7);
  const nextWeekSunday = new Date(thisWeekSunday);
  nextWeekSunday.setDate(nextWeekSunday.getDate() + 7);
  
  // Tính deadline 18h Thứ 6 của tuần HIỆN TẠI
  const fridayOfThisWeek = new Date(thisWeekMonday);
  fridayOfThisWeek.setDate(fridayOfThisWeek.getDate() + 4); // Thứ 2 + 4 = Thứ 6
  fridayOfThisWeek.setHours(18, 0, 0, 0); // 18:00:00
  
  // Lấy thứ hiện tại (0 = Chủ nhật, 6 = Thứ 7)
  const dayOfWeek = now.getDay();
  const isWeekendNow = dayOfWeek === 0 || dayOfWeek === 6;
  
  // Thứ của ngày target (0 = CN, 6 = Thứ 7)
  const targetDayOfWeek = targetDate.getDay();
  const isTargetWeekend = targetDayOfWeek === 0 || targetDayOfWeek === 6;
  
  console.log(`[DEADLINE CHECK] Target: ${targetDate.toDateString()}, Day: ${targetDayOfWeek}, isTargetWeekend: ${isTargetWeekend}`);
  console.log(`[DEADLINE CHECK] This week: ${thisWeekMonday.toDateString()} - ${thisWeekSunday.toDateString()}`);
  console.log(`[DEADLINE CHECK] Next week: ${nextWeekMonday.toDateString()} - ${nextWeekSunday.toDateString()}`);
  console.log(`[DEADLINE CHECK] Friday deadline: ${fridayOfThisWeek.toDateString()}`);
  console.log(`[DEADLINE CHECK] Now: ${now.toDateString()}, DayOfWeek: ${dayOfWeek}, isWeekendNow: ${isWeekendNow}`);
  console.log(`[DEADLINE CHECK] Is now < deadline: ${now < fridayOfThisWeek}`);
  
  // Xác định targetDate thuộc tuần nào
  const isThisWeek = targetDate >= thisWeekMonday && targetDate <= thisWeekSunday;
  const isNextWeek = targetDate >= nextWeekMonday && targetDate <= nextWeekSunday;
  
  // Trường hợp 1: Tuần HIỆN TẠI → KHẨN CẤP (emergency)
  if (isThisWeek) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (targetDate < today) {
      return { 
        allowed: false, 
        isEmergency: false,
        weekType: 'current',
        message: 'Không thể thay đổi lịch quá khứ.',
        reason: 'past_date'
      };
    }
    
    return { 
      allowed: true, 
      isEmergency: true, 
      weekType: 'current',
      message: 'Báo bận trong tuần hiện tại sẽ tính là khẩn cấp. Vui lòng sử dụng chức năng "Báo bận cả ngày".',
      reason: 'current_week_requires_all_day'
    };
  }
  
  // Trường hợp 2: Tuần SAU
  if (isNextWeek) {
    // Kiểm tra: Ngày báo bận là Thứ 7 hoặc CN -> KHÔNG CHO PHÉP
    if (isTargetWeekend) {
      return { 
        allowed: false, 
        isEmergency: false,
        weekType: 'next',
        message: 'Không thể báo bận vào ngày cuối tuần. Vui lòng chọn ngày trong tuần.',
        reason: 'weekend_not_allowed'
      };
    }
    
    // Kiểm tra các điều kiện KHẨN CẤP:
    // 1. Hôm nay là cuối tuần (Thứ 7 hoặc CN) → KHẨN CẤP
    // 2. Đã quá deadline 18h Thứ 6 → KHẨN CẨP
    const isAfterDeadline = now >= fridayOfThisWeek;
    
    if (isWeekendNow || isAfterDeadline) {
      return { 
        allowed: true, 
        isEmergency: true,
        weekType: 'next',
        message: 'Đã quá hạn 18h Thứ 6 hoặc cuối tuần. Chỉ có thể báo bận khẩn cấp (cả ngày).',
        reason: 'after_deadline_or_weekend'
      };
    } else {
      // TRƯỚC deadline (Thứ 2-5 trước 18h Thứ 6) → BÌNH THƯỜNG
      return { 
        allowed: true, 
        isEmergency: false,
        weekType: 'next',
        message: 'Báo bận bình thường. Bạn có thể báo theo ca hoặc cả ngày.',
        reason: 'normal_before_deadline'
      };
    }
  }
  
  // Trường hợp 3: Tuần trước (quá khứ) hoặc xa hơn (tuần sau nữa) - không cho phép
  if (targetDate < thisWeekMonday || targetDate > nextWeekSunday) {
    return { 
      allowed: false, 
      isEmergency: false,
      weekType: targetDate < thisWeekMonday ? 'past' : 'future',
      message: targetDate < thisWeekMonday ? 'Không thể thay đổi lịch quá khứ.' : 'Chỉ có thể báo bận tối đa cho tuần sau.',
      reason: targetDate < thisWeekMonday ? 'past_week' : 'too_far_future'
    };
  }
  
  // Mặc định: cho phép bình thường
  return { 
    allowed: true, 
    isEmergency: false,
    weekType: 'other',
    message: 'Báo bận bình thường.',
    reason: 'normal'
  };
};

// ==========================================
// UC24: Giảng viên Đăng ký / Hủy lịch bận (ROBUST VERSION)
// ==========================================
export const toggleBusy = async (req, res) => {
  try {
    const { date, timeSlot } = req.body;
    const instructorId = req.userId;

    if (!date || !timeSlot) {
      return res.status(400).json({ status: 'error', message: 'Thiếu date hoặc timeSlot' });
    }

    const inputDate = new Date(date);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ status: 'error', message: 'Ngày không hợp lệ' });
    }

    // [MỚI] Kiểm tra ngày nghỉ lễ (toàn hệ thống hoặc theo khu vực của thầy)
    const instructor = await User.findById(instructorId).select('workingLocation').lean();
    const instructorLocation = instructor?.workingLocation || null;
    const holidayCheck = await checkIsHoliday(inputDate, instructorLocation);
    if (holidayCheck) {
      const locationMsg = holidayCheck.location ? `tại khu vực ${holidayCheck.location}` : 'toàn hệ thống';
      return res.status(400).json({
        status: 'error',
        message: `Ngày ${inputDate.toLocaleDateString('vi-VN')} thuộc lịch nghỉ "${holidayCheck.title}" ${locationMsg}. Không thể báo bận trong ngày nghỉ.`
      });
    }

    // 1. Kiểm tra deadline - xác định có phải emergency không
    const deadlineCheck = checkInstructorDeadline(date);
    const isEmergency = deadlineCheck.isEmergency; // Sử dụng isEmergency từ checkInstructorDeadline

    // [MỚI] Kiểm tra: Báo bận theo ca
    // Vẫn cho phép emergency (khẩn cấp) báo bận theo ca
    if (deadlineCheck.reason === 'past_date' || deadlineCheck.reason === 'past_week') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Không thể thay đổi lịch trình trong quá khứ.' 
      });
    }

    // 2. Nếu là emergency -> kiểm tra giới hạn 2 lần/tháng
    // Nếu đã hết quota hoặc vượt quota -> vẫn cho phép nhưng cần admin duyệt
    let requiresAdminApproval = false;
    if (isEmergency) {
      const limitCheck = await checkEmergencyLeaveLimit(instructorId);
      
      // Nếu đã hết quota (>=2) -> cần admin duyệt
      if (limitCheck.count >= 2) {
        requiresAdminApproval = true;
      }
    }

    // 3. Chuẩn hóa ngày để tìm trong khoảng từ 00:00:00 đến 23:59:59
    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);

    const slotNumber = Number(timeSlot);

    // [MỚI] Tìm lịch bận (Schedule) trong ca đó để xem có phải đang HỦY báo bận khẩn cấp không
    const existingSchedule = await Schedule.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: slotNumber
    });

    // 4. Kiểm tra xem đã có Booking (Lịch học viên) chưa
    const existingBooking = await Booking.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: String(slotNumber),
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).populate('learnerId', 'fullName email phone');

    // Nếu đã có lịch bận và lịch bận đó là KHẨN CẤP -> Tạo Request yêu cầu HỦY BÁO BẬN
    if (existingSchedule && existingSchedule.isEmergency) {
      const instructorInfo = await User.findById(instructorId).select('fullName email workingLocation');
      
      const request = await Request.create({
        user: instructorId,
        type: 'INSTRUCTOR_BUSY',
        reason: `Giáo viên ${instructorInfo.fullName} xin HỦY báo bận khẩn cấp ngày ${inputDate.toLocaleDateString('vi-VN')} ca ${timeSlot}.`,
        metadata: {
          date: inputDate,
          timeSlot: slotNumber,
          isEmergency: true,
          requiresAdminApproval: true,
          instructorName: instructorInfo.fullName,
          instructorEmail: instructorInfo.email,
          instructorLocation: instructorInfo.workingLocation,
          action: 'RESTORE_SCHEDULE' // Admin duyệt sẽ xóa Schedule
        }
      });

      return res.status(200).json({
        status: 'pending_approval',
        message: 'Yêu cầu hủy báo bận khẩn cấp đã được gửi cho admin duyệt.',
        requestId: request._id,
        requiresApproval: true
      });
    }

    // Nếu đã có lịch bận nhưng KHÔNG PHẢI KHẨN CẤP -> Hủy ngay lập tức (không cần duyệt)
    if (existingSchedule && !existingSchedule.isEmergency) {
      await Schedule.findByIdAndDelete(existingSchedule._id);
      
      emitScheduleUpdate({ instructorId, date: startOfDay, timeSlot: slotNumber, status: 'AVAILABLE' });

      return res.json({ 
        status: 'success', 
        message: 'Đã mở lại lịch thành công', 
        action: 'removed',
        isEmergency: false
      });
    }

    // [MỚI] Giai đoạn này tức là CHƯA CÓ lịch báo bận -> TẠO MỚI báo bận
    // Nếu là emergency -> luôn cần admin duyệt (không tự động huỷ booking)
    // Tạo request cho admin
    if (isEmergency) {
      const instructorInfo = await User.findById(instructorId).select('fullName email workingLocation');
      
      // Lấy thông tin booking nếu có
      const bookingInfo = existingBooking ? {
        learnerName: existingBooking.learnerId?.fullName,
        learnerPhone: existingBooking.learnerId?.phone,
        learnerEmail: existingBooking.learnerId?.email
      } : null;

      // Tạo request cho admin duyệt
      const request = await Request.create({
        user: instructorId,
        type: 'INSTRUCTOR_BUSY',
        reason: `Giáo viên ${instructorInfo.fullName} báo bận khẩn cấp ngày ${inputDate.toLocaleDateString('vi-VN')} ca ${timeSlot}. ${existingBooking ? 'Có học viên đặt lịch.' : 'Không có học viên đặt lịch.'}`,
        metadata: {
          date: inputDate,
          timeSlot: slotNumber,
          isEmergency: true,
          requiresAdminApproval: true,
          instructorName: instructorInfo.fullName,
          instructorEmail: instructorInfo.email,
          instructorLocation: instructorInfo.workingLocation,
          bookingInfo: bookingInfo,
          action: 'CANCEL_BOOKING' // Admin duyệt sẽ huỷ booking
        }
      });

      const limitCheck = await checkEmergencyLeaveLimit(instructorId);

      return res.status(200).json({
        status: 'pending_approval',
        message: 'Yêu cầu báo bận khẩn cấp đã được gửi cho admin duyệt. Bạn sẽ được thông báo khi có quyết định.',
        requestId: request._id,
        remainingEmergency: limitCheck.remaining,
        requiresApproval: true
      });
    }

    {
      // Nếu KHÔNG THẤY -> TẠO MỚI (chỉ khi không phải emergency - emergency đã return ở trên)
      
      // Lấy thông tin giáo viên
      const instructor = await User.findById(instructorId);
      
      // Tạo schedule mới
      const newSchedule = await Schedule.create({
        instructorId,
        date: startOfDay,
        timeSlot: slotNumber,
        type: 'BUSY',
        isEmergency: isEmergency,
        note: 'Giảng viên báo bận'
      });

      // Nếu không phải emergency nhưng vẫn có booking -> thông báo cho GV biết
      if (existingBooking) {
        console.log(`⚠️ [SCHEDULE] GV báo bận (không phải emergency) trùng với booking của HV: ${existingBooking.learnerId?.fullName}`);
      }

      // Bắn socket thông báo lịch bận
      emitScheduleUpdate({ instructorId, date: startOfDay, timeSlot: slotNumber, status: 'BUSY' });

      return res.json({ 
        status: 'success', 
        message: 'Đã báo bận thành công',
        action: 'added',
        isEmergency: false,
        existingBooking: existingBooking ? {
          learnerName: existingBooking.learnerId?.fullName,
          message: 'Có học viên đặt lịch vào ca này'
        } : null
      });
    }

  } catch (error) {
    console.error("🔥 Error toggleBusy:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// Xem lịch của chính tôi (Dành cho Giảng viên)
// ==========================================
export const getMySchedule = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const instructorId = req.userId;

    if (!startDate || !endDate) {
      return res.status(400).json({ status: 'error', message: 'Cần truyền startDate và endDate' });
    }

    const filterDate = { 
      $gte: new Date(startDate), 
      $lte: new Date(endDate) 
    };

    // 1. Lấy lịch nghỉ lễ trong khoảng (chỉ nghỉ toàn hệ thống + nghỉ khu vực của thầy)
    const instructorInfo = await User.findById(instructorId).select('workingLocation').lean();
    const instructorLocation = instructorInfo?.workingLocation || null;
    const holidays = await getHolidaysInRange(new Date(startDate), new Date(endDate), instructorLocation);
    const holidaySlots = generateHolidaySlots(holidays);

    // 2. Lấy lịch bận (Busy) từ bảng Schedule
    const busyList = await Schedule.find({ 
      instructorId, 
      date: filterDate 
    }).lean();

    const bookingList = await Booking.find({ 
      instructorId, 
      date: filterDate,
      status: { $ne: 'CANCELLED' } // Không lấy lịch đã hủy
    })
    .populate('learnerId', 'fullName phone email')
    .lean();

    // Lấy thông tin sequence, buổi nghỉ, buổi vắng của từng học viên
    const enrichedBookingList = await Promise.all(bookingList.map(async (b) => {
      if (!b.learnerId) return b;
      
      const learnerBookings = await Booking.find({
        learnerId: b.learnerId._id,
        batchId: b.batchId,
        status: { $ne: 'CANCELLED' }
      }).lean();

      let absentCount = 0;
      let completedCount = 0;
      const validForSequence = [];

      learnerBookings.forEach(lb => {
        if (lb.attendance === 'ABSENT') absentCount++;
        else if (lb.attendance === 'PRESENT' || (lb.status === 'COMPLETED' && !lb.attendance)) completedCount++;

        // Những buổi KHÔNG Vắng sẽ được xếp vào Curriculum sequence
        if (lb.attendance !== 'ABSENT') {
           validForSequence.push(lb);
        }
      });

      // Sắp xếp theo tgian thực tế
      validForSequence.sort((x, y) => {
         const d1 = new Date(x.date).getTime();
         const d2 = new Date(y.date).getTime();
         if (d1 !== d2) return d1 - d2;
         return Number(x.timeSlot) - Number(y.timeSlot);
      });

      const sequenceIndex = validForSequence.findIndex(lb => lb._id.toString() === b._id.toString());
      const sequenceNumber = sequenceIndex !== -1 ? sequenceIndex + 1 : 1;

      return {
        ...b,
        learnerStats: {
           absentCount,
           completedCount,
           sequenceNumber
        }
      };
    }));

    // 4. Gộp dữ liệu trả về
    const result = [
      ...holidaySlots.map(h => ({ 
        ...h, 
        category: 'HOLIDAY'
      })),
      ...busyList.map(s => ({ 
        ...s, 
        category: 'BUSY',
        timeSlot: Number(s.timeSlot) 
      })),
      ...enrichedBookingList.map(b => ({ 
        ...b, 
        category: 'TEACHING', 
        timeSlot: Number(b.timeSlot) // Ép kiểu về số để Frontend dễ so sánh
      }))
    ];

    res.json({ status: 'success', data: result });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// Xem lịch công khai của GV (Dành cho Học viên / Admin)
// ==========================================
export const getPublicSchedule = async (req, res) => {
  try {
    const { instructorId, startDate, endDate } = req.query;

    if (!instructorId) {
      return res.status(400).json({ status: 'error', message: 'Thiếu instructorId' });
    }

    const filterStart = new Date(startDate);
    const filterEnd = new Date(endDate);
    const filterDate = {
      $gte: filterStart,
      $lte: filterEnd
    };

    const busySchedules = await Schedule.find({
      instructorId,
      date: filterDate,
      type: 'BUSY'
    })
      .populate('instructorId', 'fullName phone email')
      .lean();

    const bookedSchedules = await Booking.find({
      instructorId,
      date: filterDate,
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    })
      .populate('instructorId', 'fullName phone email')
      .lean();

    // 3. Lấy các ngày nghỉ lễ trong khoảng (chỉ nghỉ toàn hệ thống + nghỉ khu vực của thầy)
    const instructorInfo = await User.findById(instructorId).select('workingLocation').lean();
    const instructorLocation = instructorInfo?.workingLocation || null;
    const holidays = await getHolidaysInRange(filterStart, filterEnd, instructorLocation);
    const holidaySlots = generateHolidaySlots(holidays);

    // 4. Trả về format thống nhất
    // Cả BUSY và BOOKED và HOLIDAY đều là "Không khả dụng" đối với người xem
    const result = [
      ...holidaySlots.map(h => ({
        ...h,
        category: 'HOLIDAY'
      })),
      ...busySchedules.map(s => ({
        ...s,
        category: 'BUSY',   // GV bận việc riêng
        timeSlot: Number(s.timeSlot)
      })),
      ...bookedSchedules.map(b => ({
        ...b,
        category: 'BOOKED', // Đã có người học
        timeSlot: Number(b.timeSlot),
        // Đánh dấu nếu đây là lịch do chính người đang xem đặt (để hiện màu xanh thay vì xám)
        isMyBooking: req.userId && b.learnerId.toString() === req.userId.toString()
      }))
    ];

    res.json({ status: 'success', data: result });

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// [TEST] API test báo bận khẩn cấp (bỏ qua deadline)
export const testEmergencyBusy = async (req, res) => {
  try {
    const { date, timeSlot, instructorId } = req.body;
    
    if (!date || !timeSlot) {
      return res.status(400).json({ status: 'error', message: 'Thiếu date hoặc timeSlot' });
    }

    const inputDate = new Date(date);
    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);
    const slotNumber = Number(timeSlot);

    // Lấy instructorId (từ token hoặc body)
    const targetInstructorId = instructorId || req.userId;
    const instructor = await User.findById(targetInstructorId);

    // Kiểm tra có booking không
    const existingBooking = await Booking.findOne({
      instructorId: targetInstructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: String(slotNumber),
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).populate('learnerId', 'fullName email phone');

    // Kiểm tra giới hạn
    const limitCheck = await checkEmergencyLeaveLimit(targetInstructorId);
    if (!limitCheck.canEmergency) {
      return res.status(400).json({ 
        status: 'error', 
        message: `Đã sử dụng hết 2 lần/tháng. Liên hệ admin.` 
      });
    }

    // Tạo schedule emergency
    const newSchedule = await Schedule.create({
      instructorId: targetInstructorId,
      date: startOfDay,
      timeSlot: slotNumber,
      type: 'BUSY',
      isEmergency: true,
      note: '[TEST] Báo bận khẩn cấp'
    });

    // Tăng counter
    await incrementEmergencyLeave(targetInstructorId);

    // Gửi email nếu có booking
    if (existingBooking) {
      await sendEmergencyBusyNotification(instructor, existingBooking);
    }

    // Lấy thông tin mới
    const newLimit = await checkEmergencyLeaveLimit(targetInstructorId);

    res.json({
      status: 'success',
      message: '✅ Test báo bận khẩn cấp thành công!',
      data: {
        schedule: newSchedule,
        hasBooking: !!existingBooking,
        bookingDetails: existingBooking,
        emergencyLeaveRemaining: newLimit.remaining
      }
    });

  } catch (error) {
    console.error("🔥 Error testEmergencyBusy:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// [MỚI] API báo bận cả ngày
export const toggleBusyAllDay = async (req, res) => {
  try {
    const { date } = req.body;
    const instructorId = req.userId;

    if (!date) {
      return res.status(400).json({ status: 'error', message: 'Thiếu date' });
    }

    const inputDate = new Date(date);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ status: 'error', message: 'Ngày không hợp lệ' });
    }

    // [MỚI] Kiểm tra ngày nghỉ lễ (toàn hệ thống hoặc theo khu vực)
    const instructorBasic = await User.findById(instructorId).select('workingLocation').lean();
    const instructorLocation = instructorBasic?.workingLocation || null;
    const holidayCheck = await checkIsHoliday(inputDate, instructorLocation);
    if (holidayCheck) {
      const locationMsg = holidayCheck.location ? `tại khu vực ${holidayCheck.location}` : 'toàn hệ thống';
      return res.status(400).json({
        status: 'error',
        message: `Ngày ${inputDate.toLocaleDateString('vi-VN')} thuộc lịch nghỉ "${holidayCheck.title}" ${locationMsg}. Không thể báo bận trong ngày nghỉ.`
      });
    }

    // Kiểm tra deadline - xác định có phải emergency không
    const deadlineCheck = checkInstructorDeadline(date);
    
    // Kiểm tra quá khứ
    if (!deadlineCheck.allowed) {
      return res.status(400).json({ 
        status: 'error', 
        message: deadlineCheck.message || 'Không thể thay đổi lịch quá khứ.' 
      });
    }
    
    const isEmergency = deadlineCheck.isEmergency;

    // Nếu là emergency -> kiểm tra giới hạn
    // Nếu đã hết quota hoặc vượt quota -> vẫn cho phép nhưng cần admin duyệt
    let requiresAdminApproval = false;
    if (isEmergency) {
      const limitCheck = await checkEmergencyLeaveLimit(instructorId);
      
      // Nếu đã hết quota (>=2) -> cần admin duyệt
      if (limitCheck.count >= 2) {
        requiresAdminApproval = true;
      }
    }

    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);

    const instructorInfo = await User.findById(instructorId).select('fullName email workingLocation');
    const allSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let existingBookings = [];

    // [MỚI] Lấy tất cả lịch bận (Schedule) trong ngày hôm nay của giáo viên
    const existingSchedules = await Schedule.find({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    // Nếu đã bận full 10 ca và TẤT CẢ đều là KHẨN CẤP -> tạo Request HỦY KHẨN CẤP CẢ NGÀY
    const emergencySchedules = existingSchedules.filter(s => s.isEmergency);
    if (emergencySchedules.length === 10) {
      const request = await Request.create({
        user: instructorId,
        type: 'INSTRUCTOR_BUSY',
        reason: `Giáo viên ${instructorInfo.fullName} xin HỦY báo bận khẩn cấp cả ngày ${inputDate.toLocaleDateString('vi-VN')}.`,
        metadata: {
          date: inputDate,
          timeSlot: 'all',
          isEmergency: true,
          requiresAdminApproval: true,
          instructorName: instructorInfo.fullName,
          instructorEmail: instructorInfo.email,
          instructorLocation: instructorInfo.workingLocation,
          action: 'RESTORE_SCHEDULE' // Admin duyệt sẽ xóa toàn bộ Schedule ngày đó
        }
      });

      return res.status(200).json({
        status: 'pending_approval',
        message: 'Yêu cầu hủy báo bận khẩn cấp cả ngày đã được gửi cho admin duyệt.',
        requestId: request._id,
        requiresApproval: true
      });
    }

    // Kiểm tra tất cả các ca trong ngày xem có khóa nào đã được học viên đặt không
    for (const slotNumber of allSlots) {
      const existingBooking = await Booking.findOne({
        instructorId,
        date: { $gte: startOfDay, $lte: endOfDay },
        timeSlot: String(slotNumber),
        status: { $nin: ['CANCELLED', 'REJECTED'] }
      }).populate('learnerId', 'fullName email phone');

      if (existingBooking) {
        existingBookings.push({
          timeSlot: slotNumber,
          ...existingBooking.toObject()
        });
      }
    }

    // [MỚI] Giai đoạn này là TẠO MỚI báo bận khẩn cấp (nếu isEmergency = true)
    // Nếu là emergency -> luôn cần admin duyệt
    if (isEmergency) {
      // Tạo request cho admin duyệt
      const request = await Request.create({
        user: instructorId,
        type: 'INSTRUCTOR_BUSY',
        reason: `Giáo viên ${instructorInfo.fullName} báo bận khẩn cấp cả ngày ${inputDate.toLocaleDateString('vi-VN')}. ${existingBookings.length > 0 ? `Có ${existingBookings.length} học viên đặt lịch.` : 'Không có học viên đặt lịch.'}`,
        metadata: {
          date: inputDate,
          timeSlot: 'all', // Cả ngày
          isEmergency: true,
          requiresAdminApproval: true,
          instructorName: instructorInfo.fullName,
          instructorEmail: instructorInfo.email,
          instructorLocation: instructorInfo.workingLocation,
          bookingsInfo: existingBookings.map(b => ({
            timeSlot: b.timeSlot,
            learnerName: b.learnerId?.fullName,
            learnerPhone: b.learnerId?.phone,
            learnerEmail: b.learnerId?.email
          })),
          action: 'CANCEL_BOOKING' // Admin duyệt sẽ huỷ booking
        }
      });

      const limitCheck = await checkEmergencyLeaveLimit(instructorId);

      return res.status(200).json({
        status: 'pending_approval',
        message: 'Yêu cầu báo bận khẩn cấp cả ngày đã được gửi cho admin duyệt. Bạn sẽ được thông báo khi có quyết định.',
        requestId: request._id,
        existingBookingsCount: existingBookings.length,
        remainingEmergency: limitCheck.remaining,
        requiresApproval: true
      });
    }

    // Nếu không phải emergency -> xử lý bình thường (không huỷ booking)
    let successCount = 0;
    for (const slotNumber of allSlots) {
      // Kiểm tra schedule đã tồn tại
      const existingSchedule = await Schedule.findOne({
        instructorId,
        date: { $gte: startOfDay, $lte: endOfDay },
        timeSlot: slotNumber
      });

      if (existingSchedule) {
        // Đã có -> xóa (mở lại)
        await Schedule.findByIdAndDelete(existingSchedule._id);
        emitScheduleUpdate({ instructorId, date: startOfDay, timeSlot: slotNumber, status: 'AVAILABLE' });
      } else {
        // Chưa có -> tạo mới
        await Schedule.create({
          instructorId,
          date: startOfDay,
          timeSlot: slotNumber,
          type: 'BUSY',
          isEmergency: false,
          note: 'Giảng viên báo bận cả ngày'
        });
        emitScheduleUpdate({ instructorId, date: startOfDay, timeSlot: slotNumber, status: 'BUSY' });
        successCount++;
      }
    }

    const newLimit = await checkEmergencyLeaveLimit(instructorId);

    // Tạo thông báo chi tiết
    let message = `Đã báo bận ${successCount} ca trong ngày.`;
    
    if (existingBookings.length > 0) {
      message += ` Lưu ý: Có ${existingBookings.length} học viên đã đặt lịch trong ngày này.`;
    }

    res.json({
      status: 'success',
      message: message,
      data: {
        successCount,
        existingBookingsCount: existingBookings.length,
        isEmergency: false,
        remainingEmergency: newLimit.remaining
      }
    });

  } catch (error) {
    console.error("🔥 Error toggleBusyAllDay:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// [MỚI] API lấy thống kê thời gian dạy theo tháng cho giáo viên
// ==========================================
export const getInstructorMonthlyStats = async (req, res) => {
  try {
    const instructorId = req.userId;
    const currentMonth = getCurrentMonth();
    
    // Lấy ngày đầu tháng và cuối tháng
    const [year, month] = currentMonth.split('-').map(Number);
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
    
    // Lấy tất cả booking đã hoàn thành trong tháng
    const completedBookings = await Booking.find({
      instructorId,
      status: 'COMPLETED',
      date: { $gte: startOfMonth, $lte: endOfMonth }
    }).lean();
    
    const totalSessionsThisMonth = completedBookings.length;
    const totalHoursThisMonth = totalSessionsThisMonth; // Mỗi ca = 1 tiếng
    
    // Lấy lịch sử các tháng trước (12 tháng gần nhất)
    const monthlyHistory = [];
    const today = new Date();
    
    for (let i = 1; i <= 12; i++) {
      const targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const histYear = targetDate.getFullYear();
      const histMonth = targetDate.getMonth() + 1;
      const histMonthStr = `${histYear}-${String(histMonth).padStart(2, '0')}`;
      
      const histStart = new Date(histYear, histMonth - 1, 1);
      const histEnd = new Date(histYear, histMonth, 0, 23, 59, 59, 999);
      
      const histBookings = await Booking.find({
        instructorId,
        status: 'COMPLETED',
        date: { $gte: histStart, $lte: histEnd }
      }).lean();
      
      monthlyHistory.push({
        month: histMonthStr,
        sessions: histBookings.length,
        hours: histBookings.length
      });
    }
    
    res.json({
      status: 'success',
      data: {
        currentMonth,
        totalHoursThisMonth,
        totalSessionsThisMonth,
        monthlyHistory: monthlyHistory.reverse() // Đảo ngược để hiển thị từ cũ đến mới
      }
    });
    
  } catch (error) {
    console.error("🔥 Error getInstructorMonthlyStats:", error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};
