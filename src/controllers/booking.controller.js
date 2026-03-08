import Booking from '../models/Booking.js';
import Schedule from '../models/Schedule.js';       
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import { sendNotificationEmail } from '../services/email.service.js';

// [HELPER 1] Kiểm tra khoảng cách thời gian (Quy tắc 12h)
// Logic: Trả về số giờ chênh lệch. Nếu < 0 là quá khứ, < 12 là gấp.
const checkTimeDistance = (slotDateStr, slotTimeSlot) => {
  // 10 ca học theo frontend
  const SLOT_START_HOURS = { 
    "1": 7, "2": 8.5, "3": 10, "4": 11.5, 
    "5": 13, "6": 14.5, "7": 16, "8": 17.5, 
    "9": 19, "10": 20.5 
  };
  const startHour = SLOT_START_HOURS[String(slotTimeSlot)] || 7;
  
  const targetTime = new Date(slotDateStr);
  targetTime.setHours(Math.floor(startHour), (startHour % 1) * 60, 0, 0); 

  const now = new Date();
  const diffMs = targetTime - now;
  return diffMs / (1000 * 60 * 60); // Trả về số giờ
};

// [HELPER 2 - MỚI] Kiểm tra giới hạn tuần (Current Week + Next Week)
const checkBookingLimit = (slotDateStr) => {
  const today = new Date();
  const targetDate = new Date(slotDateStr);

  // 1. Tính ngày Chủ nhật của TUẦN SAU
  // Logic: Tìm CN tuần này -> Cộng thêm 7 ngày -> Ra CN tuần sau
  const currentDay = today.getDay(); // 0 (Sun) - 6 (Sat)
  const daysUntilSunday = 0 - currentDay + (currentDay === 0 ? 0 : 7); // Khoảng cách đến CN tuần này
  
  const thisSunday = new Date(today);
  thisSunday.setDate(today.getDate() + daysUntilSunday);
  
  const endOfNextWeek = new Date(thisSunday);
  endOfNextWeek.setDate(thisSunday.getDate() + 7); // CN tuần sau
  endOfNextWeek.setHours(23, 59, 59, 999);

  // 2. Kiểm tra:
  // Nếu ngày đặt > CN tuần sau -> CHẶN
  if (targetDate > endOfNextWeek) {
    return { 
      allowed: false, 
      message: 'Chưa mở đăng ký cho các tuần xa hơn. Chỉ được đăng ký tối đa đến hết tuần sau.' 
    };
  }

  // Lưu ý: Không chặn quá khứ ở đây vì hàm checkTimeDistance đã lo việc đó (quy tắc 12h)
  return { allowed: true };
};

// [HELPER 3 - MỚI] Kiểm tra thời điểm mở đăng ký tuần sau (18:30 thứ 6)
// Học viên chỉ có thể đăng ký tuần sau SAU 18:30 (6:30 tối) thứ 6
const checkNextWeekBookingTime = (slotDateStr) => {
  const now = new Date();
  const targetDate = new Date(slotDateStr);

  // Tính ngày Chủ nhật tuần này
  const currentDay = now.getDay();
  const daysUntilSunday = 0 - currentDay + (currentDay === 0 ? 0 : 7);
  const thisSunday = new Date(now);
  thisSunday.setDate(now.getDate() + daysUntilSunday);
  thisSunday.setHours(23, 59, 59, 999);

  // Nếu ngày đặt nằm trong tuần này hoặc quá khứ -> cho phép
  if (targetDate <= thisSunday) {
    return { allowed: true };
  }

  // Nếu ngày đặt là tuần sau -> kiểm tra thời gian
  // Tính 18:30 thứ 6 của tuần này
  const thisFriday = new Date(now);
  const diffToFriday = 5 - currentDay;
  thisFriday.setDate(now.getDate() + diffToFriday);
  thisFriday.setHours(18, 30, 0, 0); // 18:30:00

  // Nếu chưa đến 18:30 thứ 6 -> chặn đăng ký tuần sau
  if (now < thisFriday) {
    return { 
      allowed: false, 
      message: 'Chưa đến giờ mở đăng ký tuần sau. Bạn sẽ có thể đăng ký lịch tuần sau vào lúc 18:30 (6:30 tối) thứ 6.' 
    };
  }

  return { allowed: true };
};

// 1. Lấy tất cả bookings
export const getAllBookings = async (req, res) => {
  try {
    const { studentId, instructorId, status } = req.query;
    const filter = {};
    
    if (studentId) filter.studentId = studentId;
    if (instructorId) filter.instructorId = instructorId;
    
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: 'CANCELLED' }; 
    }
    
    const bookings = await Booking.find(filter)
      .populate('studentId', 'fullName phone')
      .populate('instructorId', 'fullName phone')
      .populate('batchId', 'startDate location')
      .sort({ date: 1, timeSlot: 1 });
    
    res.json({ status: 'success', data: bookings, count: bookings.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 2. Lấy booking theo ID
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id)
      .populate('studentId').populate('instructorId').populate('batchId');
    if (!booking) return res.status(404).json({ status: 'error', message: 'Booking not found' });
    res.json({ status: 'success', data: booking });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 3. Tạo Booking mới
export const createBooking = async (req, res) => {
  try {
    const { instructorId, date, timeSlot, type } = req.body;
    const studentId = req.userId;

    // A. CHECK 12H (Quy tắc quan trọng nhất)
    const hoursUntilClass = checkTimeDistance(date, timeSlot);
    if (hoursUntilClass < 0) {
      return res.status(400).json({ status: 'error', message: 'Ca học này đã trôi qua.' });
    }
    if (hoursUntilClass < 12) {
      return res.status(400).json({ status: 'error', message: 'Phải đăng ký trước ít nhất 12 tiếng.' });
    }

    // B. CHECK GIỚI HẠN TUẦN (Không cho book quá xa)
    const limitCheck = checkBookingLimit(date);
    if (!limitCheck.allowed) {
      return res.status(400).json({ status: 'error', message: limitCheck.message });
    }

    // C. CHECK THỜI ĐIỂM MỞ ĐĂNG KÝ TUẦN SAU (18:30 thứ 6)
    const timeCheck = checkNextWeekBookingTime(date);
    if (!timeCheck.allowed) {
      return res.status(400).json({ status: 'error', message: timeCheck.message });
    }

    // D. CÁC CHECK LOGIC KHÁC
    const registration = await Registration.findOne({
      studentId,
      status: { $in: ['STUDYING', 'PROCESSING', 'NEW'] } 
    });

    if (!registration) return res.status(400).json({ status: 'error', message: 'Bạn chưa đăng ký khóa học!' });

    const batchId = registration.batchId;
    const bookingDate = new Date(date);
    bookingDate.setUTCHours(0, 0, 0, 0); 
    const startOfDay = new Date(bookingDate);
    const endOfDay = new Date(bookingDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const isBusy = await Schedule.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay },
      timeSlot: Number(timeSlot),
      type: 'BUSY'
    });
    
    if (isBusy) return res.status(400).json({ status: 'error', message: 'Giáo viên đã báo bận.' });

    const existingBooking = await Booking.findOne({
        instructorId,
        date: { $gte: startOfDay, $lte: endOfDay },
        timeSlot: String(timeSlot),
        status: { $ne: 'CANCELLED' }
    });

    if (existingBooking) return res.status(400).json({ status: 'error', message: 'Giáo viên đã có lịch dạy slot này.' });

    const newBooking = new Booking({
      studentId, 
      instructorId, 
      batchId,
      date: bookingDate,
      timeSlot: String(timeSlot),
      status: 'BOOKED',
      type: type || 'PRACTICE'
    });

    await newBooking.save();
    res.status(201).json({ status: 'success', message: 'Đặt lịch thành công!', data: newBooking });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 4. Cập nhật trạng thái / Hủy lịch
export const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // --- CHECK 12H RULE KHI HỦY ---
    if (status === 'CANCELLED') {
        const currentBooking = await Booking.findById(id);
        if (!currentBooking) return res.status(404).json({ message: 'Không tìm thấy lịch' });

        const hoursUntilClass = checkTimeDistance(currentBooking.date, currentBooking.timeSlot);
        
        if (hoursUntilClass < 0) {
            return res.status(400).json({ status: 'error', message: 'Buổi học đã diễn ra, không thể hủy.' });
        }

        if (hoursUntilClass < 12) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Không thể hủy lịch gấp (dưới 12 tiếng trước giờ học).' 
            });
        }
    }
    // -----------------------------

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );

    if (!updatedBooking) return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch' });
    res.json({ status: 'success', message: 'Cập nhật thành công', data: updatedBooking });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 5. Giáo viên điểm danh
export const takeAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { attendance, instructorNote } = req.body; 

    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch học' });

    const hoursDiff = checkTimeDistance(booking.date, booking.timeSlot);
    if (hoursDiff > 0) {
        return res.status(400).json({ status: 'error', message: 'Chưa đến giờ học, không thể điểm danh sớm!' });
    }

    const status = attendance === 'PRESENT' ? 'COMPLETED' : 'ABSENT';

    booking.attendance = attendance;
    booking.instructorNote = instructorNote;
    booking.status = status;
    
    await booking.save();

    res.json({ status: 'success', message: 'Điểm danh thành công', data: booking });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 6. Học viên đánh giá
export const submitFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, studentFeedback } = req.body;

    const booking = await Booking.findById(id);
    
    if (!booking || booking.status !== 'COMPLETED') {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Bạn chỉ có thể đánh giá sau khi đã hoàn thành buổi học.' 
      });
    }

    booking.rating = rating;
    booking.studentFeedback = studentFeedback;
    booking.feedbackDate = new Date();
    await booking.save();

    res.json({ status: 'success', message: 'Cảm ơn bạn đã đánh giá!' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// [HELPER 4] Lấy thông tin trạng thái mở đăng ký tuần sau
// Dùng để frontend hiển thị thông báo cho học viên
export const getBookingStatus = async (req, res) => {
  try {
    const now = new Date();
    const currentDay = now.getDay(); // 0 (Sun) - 6 (Sat)

    // Tính 18:30 thứ 6 của tuần này
    const thisFriday = new Date(now);
    const diffToFriday = 5 - currentDay;
    thisFriday.setDate(now.getDate() + diffToFriday);
    thisFriday.setHours(18, 30, 0, 0);

    // Tính Chủ nhật tuần này
    const thisSunday = new Date(now);
    const daysUntilSunday = 0 - currentDay + (currentDay === 0 ? 0 : 7);
    thisSunday.setDate(now.getDate() + daysUntilSunday);
    thisSunday.setHours(23, 59, 59, 999);

    // Tính Chủ nhật tuần sau
    const nextSunday = new Date(thisSunday);
    nextSunday.setDate(thisSunday.getDate() + 7);
    nextSunday.setHours(23, 59, 59, 999);

    // Xác định trạng thái
    const isNextWeekOpen = now >= thisFriday; // Đã đến 18:30 thứ 6
    const nextWeekOpenTime = thisFriday.toISOString(); // Thời điểm mở

    // Nếu đã qua thứ 7 tuần này -> tuần sau luôn mở
    // Nếu là thứ 6 trước 18:30 -> chưa mở
    // Nếu là thứ 6 sau 18:30 hoặc CN -> đã mở

    res.json({
      status: 'success',
      data: {
        isNextWeekOpen,
        nextWeekOpenTime,
        currentTime: now.toISOString(),
        message: isNextWeekOpen 
          ? 'Đã mở đăng ký tuần sau' 
          : `Sẽ mở đăng ký tuần sau vào lúc 18:30 thứ 6`
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// [TEST] Endpoint test gửi mail nhắc điểm danh
// 10 ca học theo frontend
const SLOT_END_TIMES = {
  "1": { hour: 8, minute: 0 },    // Ca 1: 07:00-08:00
  "2": { hour: 9, minute: 30 },  // Ca 2: 08:30-09:30
  "3": { hour: 11, minute: 0 },  // Ca 3: 10:00-11:00
  "4": { hour: 12, minute: 30 }, // Ca 4: 11:30-12:30
  "5": { hour: 14, minute: 0 },  // Ca 5: 13:00-14:00
  "6": { hour: 15, minute: 30 }, // Ca 6: 14:30-15:30
  "7": { hour: 17, minute: 0 },  // Ca 7: 16:00-17:00
  "8": { hour: 18, minute: 30 }, // Ca 8: 17:30-18:30
  "9": { hour: 20, minute: 0 },  // Ca 9: 19:00-20:00
  "10": { hour: 21, minute: 30 }, // Ca 10: 20:30-21:30
};

const SLOT_LABELS = {
  "1": "Ca 1 (07:00 - 08:00)",
  "2": "Ca 2 (08:30 - 09:30)",
  "3": "Ca 3 (10:00 - 11:00)",
  "4": "Ca 4 (11:30 - 12:30)",
  "5": "Ca 5 (13:00 - 14:00)",
  "6": "Ca 6 (14:30 - 15:30)",
  "7": "Ca 7 (16:00 - 17:00)",
  "8": "Ca 8 (17:30 - 18:30)",
  "9": "Ca 9 (19:00 - 20:00)",
  "10": "Ca 10 (20:30 - 21:30)",
};

// [TEST] Gửi mail nhắc điểm danh cho tất cả booking chưa điểm danh đã kết thúc
export const testSendAttendanceReminder = async (req, res) => {
  try {
    // Tìm các booking chưa điểm danh và đã kết thúc + 5 phút
    const bookings = await Booking.find({
      status: 'BOOKED',
      attendance: { $exists: false }
    }).populate('studentId', 'fullName email phone')
      .populate('instructorId', 'fullName email phone');

    let reminderCount = 0;

    for (const booking of bookings) {
      const { hour, minute } = SLOT_END_TIMES[String(booking.timeSlot)] || { hour: 17, minute: 0 };
      
      // Tính thời điểm kết thúc ca học + 5 phút
      const classEndTime = new Date(booking.date);
      classEndTime.setHours(hour, minute, 0, 0);
      
      const reminderTime = new Date(classEndTime.getTime() + 5 * 60 * 1000); // +5 phút
      const now = new Date();

      // Nếu đã đến hoặc qua thời điểm kết thúc + 5 phút
      if (now >= reminderTime) {
        // Gửi email nhắc nhở cho cả giáo viên và học viên
        const classDateStr = new Date(booking.date).toLocaleDateString('vi-VN', {
          weekday: 'long',
          day: 'numeric',
          month: 'numeric',
          year: 'numeric'
        });

        const title = '⏰ [TEST] Nhắc nhở: Buổi học chưa được điểm danh';
        const message = `Kính gửi Quý Thầy/Cô và Học viên,

Buổi học ngày ${classDateStr} ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot} đã kết thúc nhưng chưa được điểm danh.

Vui lòng thực hiện điểm danh ngay để hoàn tất buổi học.

Thông tin buổi học:
- Ngày: ${classDateStr}
- Ca: ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot}
- Giáo viên: ${booking.instructorId?.fullName || 'N/A'}
- Học viên: ${booking.studentId?.fullName || 'N/A'}

Trân trọng!`;

        // Gửi email cho giáo viên
        if (booking.instructorId?.email) {
          await sendNotificationEmail(booking.instructorId.email, title, message);
          console.log(`✅ [TEST] Đã gửi email nhắc điểm danh cho giáo viên: ${booking.instructorId.fullName}`);
        }

        // Gửi email cho học viên
        if (booking.studentId?.email) {
          await sendNotificationEmail(booking.studentId.email, title, message);
          console.log(`✅ [TEST] Đã gửi email nhắc điểm danh cho học viên: ${booking.studentId.fullName}`);
        }

        reminderCount++;
      }
    }

    res.json({
      status: 'success',
      message: `Đã gửi ${reminderCount} email nhắc nhở điểm danh (test)`
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};