import Schedule from '../models/Schedule.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import SystemHoliday from '../models/SystemHoliday.js';
import { sendNotificationEmail } from '../services/email.service.js';

// [HELPER] Kiểm tra ngày có trong lịch nghỉ không (định nghĩa trực tiếp để tránh circular dependency)
const checkIsHoliday = async (date) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const holiday = await SystemHoliday.findOne({
    startDate: { $lte: targetDate },
    endDate: { $gte: targetDate },
    isActive: true
  });

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
// Logic mới:
// - Tuần hiện tại (Thứ 2 -> Chủ nhật): Chỉ cho phép báo bận cả ngày (emergency)
// - Tuần sau (Thứ 2 -> Chủ nhật):
//   - Trước 18h Thứ 6 tuần này: Bình thường (theo ca hoặc cả ngày)
//   - Sau 18h Thứ 6 tuần này: Emergency (chỉ cả ngày)
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
  
  console.log(`[DEADLINE CHECK] Target: ${targetDate.toDateString()}`);
  console.log(`[DEADLINE CHECK] This week: ${thisWeekMonday.toDateString()} - ${thisWeekSunday.toDateString()}`);
  console.log(`[DEADLINE CHECK] Next week: ${nextWeekMonday.toDateString()} - ${nextWeekSunday.toDateString()}`);
  console.log(`[DEADLINE CHECK] Friday deadline: ${fridayOfThisWeek.toDateString()}`);
  console.log(`[DEADLINE CHECK] Now: ${now.toDateString()}, Is before deadline: ${now < fridayOfThisWeek}`);
  
  // Xác định targetDate thuộc tuần nào
  const isThisWeek = targetDate >= thisWeekMonday && targetDate <= thisWeekSunday;
  const isNextWeek = targetDate >= nextWeekMonday && targetDate <= nextWeekSunday;
  
  // Trường hợp 1: Tuần HIỆN TẠI -> Chỉ cho phép báo bận cả ngày (emergency)
  if (isThisWeek) {
    // Check xem ngày đó đã qua chưa
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
  
  // Trường hợp 2: Tuần SAU hoặc xa hơn
  if (isNextWeek || targetDate > thisWeekSunday) {
    // Nếu là tuần sau (hoặc xa hơn) và TRƯỚC deadline 18h Thứ 6
    if (now < fridayOfThisWeek) {
      return { 
        allowed: true, 
        isEmergency: false,
        weekType: 'next',
        message: 'Báo bận bình thường. Bạn có thể báo theo ca hoặc cả ngày.',
        reason: 'normal_before_deadline'
      };
    } else {
      // Sau deadline 18h Thứ 6 -> Chỉ cho phép báo bận cả ngày (emergency)
      return { 
        allowed: true, 
        isEmergency: true,
        weekType: 'next',
        message: 'Đã quá hạn 18h Thứ 6. Chỉ có thể báo bận khẩn cấp (cả ngày).',
        reason: 'after_deadline_requires_all_day'
      };
    }
  }
  
  // Trường hợp 3: Tuần trước (quá khứ) - không cho phép
  if (targetDate < thisWeekMonday) {
    return { 
      allowed: false, 
      isEmergency: false,
      weekType: 'past',
      message: 'Không thể thay đổi lịch quá khứ.',
      reason: 'past_week'
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

    // [MỚI] Kiểm tra: Chỉ cho phép báo bận theo ca (toggleBusy) khi:
    // - Là tuần SAU VÀ trước deadline 18h Thứ 6
    // Các trường hợp khác phải dùng báo bận cả ngày (toggleBusyAllDay)
    const canUsePerSlot = deadlineCheck.weekType === 'next' && !isEmergency;
    
    if (!canUsePerSlot) {
      // Nếu tuần hiện tại hoặc sau deadline -> yêu cầu dùng báo bận cả ngày
      if (deadlineCheck.weekType === 'current') {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Trong tuần hiện tại, vui lòng sử dụng chức năng "Báo bận cả ngày" thay vì báo từng ca.' 
        });
      } else if (deadlineCheck.reason === 'after_deadline_requires_all_day') {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Đã quá hạn 18h Thứ 6. Vui lòng sử dụng chức năng "Báo bận cả ngày" cho tuần sau.' 
        });
      } else if (deadlineCheck.reason === 'past_date' || deadlineCheck.reason === 'past_week') {
        return res.status(400).json({ 
          status: 'error', 
          message: 'Không thể thay đổi lịch quá khứ.' 
        });
      }
    }

    // 2. Nếu là emergency -> kiểm tra giới hạn 2 lần/tháng
    if (isEmergency) {
      const limitCheck = await checkEmergencyLeaveLimit(instructorId);
      if (!limitCheck.canEmergency) {
        return res.status(400).json({ 
          status: 'error', 
          message: `Bạn đã sử dụng hết 2 lần báo bận khẩn cấp trong tháng này. Vui liên hệ admin để được hỗ trợ.` 
        });
      }
    }

    // 3. Chuẩn hóa ngày để tìm trong khoảng từ 00:00:00 đến 23:59:59
    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);

    const slotNumber = Number(timeSlot);

    // 4. Kiểm tra xem đã có Booking (Lịch học viên) chưa
    const existingBooking = await Booking.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: String(slotNumber),
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).populate('learnerId', 'fullName email phone');

    // [MỚI] Nếu có booking và là emergency -> huỷ booking
    if (existingBooking && isEmergency) {
      // Cập nhật trạng thái booking thành CANCELLED
      existingBooking.status = 'CANCELLED';
      existingBooking.instructorNote = 'Huỷ do giáo viên báo bận khẩn cấp';
      await existingBooking.save();
      
      // Gửi email thông báo huỷ
      const instructorForNotify = await User.findById(instructorId);
      await sendBookingCancelledNotification(instructorForNotify, existingBooking);
    }

    // 5. Tìm lịch bận (Schedule) trong CẢ NGÀY hôm đó
    const existingSchedule = await Schedule.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: slotNumber
    });

    if (existingSchedule) {
      // Nếu TÌM THẤY -> XÓA NGAY (không tính là emergency khi hủy)
      await Schedule.findByIdAndDelete(existingSchedule._id);
      
      return res.json({ 
        status: 'success', 
        message: 'Đã mở lại lịch thành công', 
        action: 'removed',
        isEmergency: existingSchedule.isEmergency || false
      });
    } else {
      // Nếu KHÔNG THẤY -> TẠO MỚI
      
      // Lấy thông tin giáo viên
      const instructor = await User.findById(instructorId);
      
      // Tạo schedule mới
      const newSchedule = await Schedule.create({
        instructorId,
        date: startOfDay,
        timeSlot: slotNumber,
        type: 'BUSY',
        isEmergency: isEmergency, // Đánh dấu nếu là emergency
        note: isEmergency ? 'Báo bận khẩn cấp (vượt deadline)' : 'Giảng viên báo bận'
      });

      // Nếu là emergency -> tăng counter và gửi email (nếu có booking thì đã huỷ ở trên)
      if (isEmergency) {
        await incrementEmergencyLeave(instructorId);
        
        // Thông báo cho GV về tình trạng huỷ booking
        if (existingBooking) {
          console.log(`✅ [SCHEDULE] Đã huỷ booking và gửi email do báo bận khẩn cấp`);
        }
      } else {
        // Nếu không phải emergency nhưng vẫn có booking -> thông báo cho GV biết
        if (existingBooking) {
          console.log(`⚠️ [SCHEDULE] GV báo bận (không phải emergency) trùng với booking của HV: ${existingBooking.learnerId?.fullName}`);
        }
      }

      // [MỚI] Tạo message thông báo
      let message = isEmergency 
        ? 'Đã báo bận khẩn cấp thành công! Lưu ý: Bạn đã sử dụng 1 lần báo bận khẩn cấp tháng này.' 
        : 'Đã báo bận thành công';
      
      if (existingBooking && isEmergency) {
        message += ' Đã huỷ lịch học của học viên và gửi email thông báo.';
      }

      return res.json({ 
        status: 'success', 
        message: message,
        action: 'added',
        isEmergency: isEmergency,
        cancelledBooking: existingBooking ? !!isEmergency : false,
        remainingEmergency: isEmergency ? (await checkEmergencyLeaveLimit(instructorId)).remaining : null
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

    // 3. Lấy lịch dạy (Teaching) từ bảng Booking
    const bookingList = await Booking.find({ 
      instructorId, 
      date: filterDate,
      status: { $ne: 'CANCELLED' } // Không lấy lịch đã hủy
    })
    .populate('learnerId', 'fullName phone')
    .lean();

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
      ...bookingList.map(b => ({ 
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

    // 1. Lấy các slot GV đã báo bận
    const busySchedules = await Schedule.find({
      instructorId,
      date: filterDate,
      type: 'BUSY'
    }).lean();

    // 2. Lấy các slot đã có người khác đặt
    const bookedSchedules = await Booking.find({
      instructorId,
      date: filterDate,
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    }).lean();

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

    // Nếu là emergency -> kiểm tra giới hạn 2 lần/tháng
    if (isEmergency) {
      const limitCheck = await checkEmergencyLeaveLimit(instructorId);
      if (!limitCheck.canEmergency) {
        return res.status(400).json({ 
          status: 'error', 
          message: `Bạn đã sử dụng hết 2 lần báo bận khẩn cấp trong tháng này. Vui liên hệ admin để được hỗ trợ.` 
        });
      }
    }

    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);

    const instructorForNotify = await User.findById(instructorId);
    const allSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let successCount = 0;
    let cancelledBookings = [];

    for (const slotNumber of allSlots) {
      // Kiểm tra booking
      const existingBooking = await Booking.findOne({
        instructorId,
        date: { $gte: startOfDay, $lte: endOfDay },
        timeSlot: String(slotNumber),
        status: { $nin: ['CANCELLED', 'REJECTED'] }
      }).populate('learnerId', 'fullName email phone');

      if (existingBooking) {
        // [MỚI] Nếu là emergency -> HUỶ booking và thông báo
        if (isEmergency) {
          // Cập nhật trạng thái booking thành CANCELLED
          existingBooking.status = 'CANCELLED';
          existingBooking.instructorNote = 'Huỷ do giáo viên báo bận khẩn cấp';
          await existingBooking.save();
          
          cancelledBookings.push(existingBooking);
          
          // Gửi email thông báo huỷ
          await sendBookingCancelledNotification(instructorForNotify, existingBooking);
        } else {
          // Không phải emergency -> bỏ qua
          continue;
        }
      }

      // Kiểm tra schedule đã tồn tại
      const existingSchedule = await Schedule.findOne({
        instructorId,
        date: { $gte: startOfDay, $lte: endOfDay },
        timeSlot: slotNumber
      });

      if (existingSchedule) {
        // Đã có -> xóa (mở lại)
        await Schedule.findByIdAndDelete(existingSchedule._id);
      } else {
        // Chưa có -> tạo mới
        await Schedule.create({
          instructorId,
          date: startOfDay,
          timeSlot: slotNumber,
          type: 'BUSY',
          isEmergency: isEmergency,
          note: isEmergency ? 'Báo bận khẩn cấp cả ngày' : 'Giảng viên báo bận cả ngày'
        });
        successCount++;
      }
    }

    // Nếu là emergency -> tăng counter
    if (isEmergency) {
      await incrementEmergencyLeave(instructorId);
    }

    const newLimit = await checkEmergencyLeaveLimit(instructorId);

    // Tạo thông báo chi tiết
    let message = isEmergency 
      ? `Đã báo bận ${successCount} ca (khẩn cấp).`
      : `Đã báo bận ${successCount} ca trong ngày.`;
    
    if (cancelledBookings.length > 0) {
      message += ` Đã huỷ ${cancelledBookings.length} lịch học và gửi email thông báo cho học viên.`;
    }

    res.json({
      status: 'success',
      message: message,
      data: {
        successCount,
        cancelledCount: cancelledBookings.length,
        isEmergency,
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
