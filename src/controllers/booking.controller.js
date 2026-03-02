import Booking from '../models/Booking.js';
import Schedule from '../models/Schedule.js';       
import Registration from '../models/Registration.js';

// [HELPER 1] Kiểm tra khoảng cách thời gian (Quy tắc 12h)
// Logic: Trả về số giờ chênh lệch. Nếu < 0 là quá khứ, < 12 là gấp.
const checkTimeDistance = (slotDateStr, slotTimeSlot) => {
  const SLOT_START_HOURS = { "1": 7, "2": 9, "3": 13, "4": 15 };
  const startHour = SLOT_START_HOURS[String(slotTimeSlot)] || 7;
  
  const targetTime = new Date(slotDateStr);
  targetTime.setHours(startHour, 0, 0, 0); 

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

    // C. CÁC CHECK LOGIC KHÁC
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