import Schedule from '../models/Schedule.js';
import Booking from '../models/Booking.js';

// [HELPER] Kiểm tra hạn chót Thứ 6 (18:00) cho việc đăng ký tuần sau
const checkInstructorDeadline = (targetDateStr) => {
  const now = new Date();
  const targetDate = new Date(targetDateStr);

  // Tính toán thời điểm 18:00 Thứ 6 của tuần HIỆN TẠI
  const currentDay = now.getDay(); // 0 (Sun) -> 6 (Sat)
  const diffToFriday = 5 - currentDay; 
  const thisFridayDeadline = new Date(now);
  thisFridayDeadline.setDate(now.getDate() + diffToFriday);
  thisFridayDeadline.setHours(18, 0, 0, 0); // 18:00:00

  // Tính Chủ nhật tuần này (Mốc để phân biệt tuần này vs tuần sau)
  const thisSunday = new Date(now);
  const diffToSunday = 0 - currentDay + (currentDay === 0 ? 0 : 7);
  thisSunday.setDate(now.getDate() + diffToSunday);
  thisSunday.setHours(23, 59, 59, 999);

  // Nếu ngày đăng ký > Chủ nhật tuần này => Là đăng ký cho tuần sau (hoặc xa hơn)
  const isNextWeekOrLater = targetDate > thisSunday;

  if (isNextWeekOrLater) {
    // Nếu là đăng ký cho tuần sau, bắt buộc phải trước Deadline Thứ 6
    if (now > thisFridayDeadline) {
      return { 
        allowed: false, 
        message: 'Đã quá hạn đăng ký lịch bận cho tuần sau (Hạn chót: 18h chiều Thứ 6 tuần này).' 
      };
    }
  } else {
    // Nếu đăng ký cho tuần hiện tại (hoặc quá khứ)
    // Theo yêu cầu: "nếu giáo viên không đăng kí lịch bận -> auto tuần sau có thể dạy"
    // => Có thể hiểu là không cho phép sửa lịch bận của tuần hiện tại để đảm bảo ổn định cho học viên
    
    // Check xem ngày đó đã qua chưa
    if (targetDate < new Date().setHours(0,0,0,0)) {
        return { allowed: false, message: 'Không thể thay đổi lịch quá khứ.' };
    }
    
    // Chặn thay đổi lịch tuần hiện tại (để tránh giáo viên báo bận đột xuất làm hỏng kế hoạch học viên)
    return { 
        allowed: false, 
        message: 'Chỉ được phép đăng ký/hủy lịch bận cho tuần kế tiếp.' 
    };
  }

  return { allowed: true };
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

    // 1. KIỂM TRA DEADLINE THỨ 6
    const deadlineCheck = checkInstructorDeadline(date);
    if (!deadlineCheck.allowed) {
      return res.status(400).json({ status: 'error', message: deadlineCheck.message });
    }

    const inputDate = new Date(date);
    if (isNaN(inputDate.getTime())) {
      return res.status(400).json({ status: 'error', message: 'Ngày không hợp lệ' });
    }

    // 2. Chuẩn hóa ngày để tìm trong khoảng từ 00:00:00 đến 23:59:59
    const startOfDay = new Date(inputDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(inputDate);
    endOfDay.setHours(23, 59, 59, 999);

    const slotNumber = Number(timeSlot);

    // 3. Kiểm tra xem đã có Booking (Lịch học viên) chưa
    const existingBooking = await Booking.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay }, // Check trong khoảng ngày
      timeSlot: String(slotNumber),
      status: { $nin: ['CANCELLED', 'REJECTED'] }
    });

    if (existingBooking) {
      return res.status(400).json({ status: 'error', message: 'Đã có học viên đặt lịch, không thể báo bận!' });
    }

    // 4. Tìm lịch bận (Schedule) trong CẢ NGÀY hôm đó
    const existingSchedule = await Schedule.findOne({
      instructorId,
      date: { $gte: startOfDay, $lte: endOfDay }, // <--- QUAN TRỌNG: Tìm mọi giờ trong ngày
      timeSlot: slotNumber
    });

    if (existingSchedule) {
      // Nếu TÌM THẤY (bất kể giờ nào) -> XÓA NGAY
      await Schedule.findByIdAndDelete(existingSchedule._id);
      return res.json({ 
        status: 'success', 
        message: 'Đã mở lại lịch thành công', 
        action: 'removed' 
      });
    } else {
      // Nếu KHÔNG THẤY -> TẠO MỚI (Lưu giờ chuẩn 00:00:00)
      await Schedule.create({
        instructorId,
        date: startOfDay, // Luôn lưu 00:00:00 để sạch data
        timeSlot: slotNumber,
        type: 'BUSY',
        note: 'Giảng viên báo bận'
      });
      
      return res.json({ 
        status: 'success', 
        message: 'Đã báo bận thành công', 
        action: 'added'
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

    // 1. Lấy lịch bận (Busy) từ bảng Schedule
    const busyList = await Schedule.find({ 
      instructorId, 
      date: filterDate 
    }).lean();

    // 2. Lấy lịch dạy (Teaching) từ bảng Booking
    const bookingList = await Booking.find({ 
      instructorId, 
      date: filterDate,
      status: { $ne: 'CANCELLED' } // Không lấy lịch đã hủy
    })
    .populate('studentId', 'fullName phone')
    .lean();

    // 3. Gộp dữ liệu trả về
    const result = [
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

    const filterDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
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

    // 3. Trả về format thống nhất
    // Cả BUSY và BOOKED đều là "Không khả dụng" đối với người xem
    const result = [
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
        isMyBooking: req.userId && b.studentId.toString() === req.userId.toString()
      }))
    ];

    res.json({ status: 'success', data: result });

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};