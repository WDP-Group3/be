import cron from 'node-cron';
import Notification from '../models/Notification.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { sendNotificationEmail } from './email.service.js';

// [CRON JOB] Gửi thông báo nhắc nhở giáo viên đăng ký lịch bận
// Chạy vào lúc 17:30 (5:30 chiều) thứ 6 hàng tuần
export const startFridayReminderCron = () => {
  console.log('📅 Cron job "Friday Reminder" đã được khởi động - Chạy lúc 17:30 thứ 6 hàng tuần');

  // Cron expression: giây phút giờ ngày tháng thứ
  // 30 17 * * 5 = 17:30 thứ 6 (Friday)
  cron.schedule('30 17 * * 5', async () => {
    console.log('🔔 [CRON] Đang gửi thông báo nhắc nhở giáo viên đăng ký lịch bận...');
    
    try {
      await sendInstructorBusyScheduleReminder();
    } catch (error) {
      console.error('❌ [CRON] Lỗi khi gửi thông báo nhắc nhở:', error);
    }
  });
};

// [CRON JOB] Kiểm tra và gửi email nhắc nhở điểm danh
// Chạy mỗi 5 phút để kiểm tra các buổi học đã kết thúc + 5 phút nhưng chưa được điểm danh
export const startAttendanceReminderCron = () => {
  console.log('⏰ Cron job "Attendance Reminder" đã được khởi động - Chạy mỗi 5 phút');

  // Chạy mỗi 5 phút
  cron.schedule('*/5 * * * *', async () => {
    console.log('🔔 [CRON ATTENDANCE] Đang kiểm tra các buổi học cần điểm danh...');
    
    try {
      await checkAndSendAttendanceReminders();
    } catch (error) {
      console.error('❌ [CRON ATTENDANCE] Lỗi khi kiểm tra điểm danh:', error);
    }
  });
};

// Thời gian kết thúc các ca học (theo frontend: 10 ca)
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

// Hàm kiểm tra và gửi nhắc nhở điểm danh
const checkAndSendAttendanceReminders = async () => {
  // Tìm các booking chưa điểm danh và đã kết thúc + 5 phút
  // Chỉ gửi email 1 lần duy nhất (attendanceReminderSent = false)
  const bookings = await Booking.find({
    status: 'BOOKED', // Chỉ lấy những buổi chưa điểm danh
    attendanceReminderSent: false, // Chỉ gửi email nếu chưa gửi
    $or: [
      { attendance: { $exists: false } }, // Chưa từng có attendance
      { attendance: 'PENDING' }            // Đã có nhưng chưa điểm danh
    ]
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
      await sendAttendanceReminderEmail(booking);
      
      // Đánh dấu đã gửi email nhắc nhở (chỉ gửi 1 lần duy nhất)
      await Booking.findByIdAndUpdate(booking._id, { attendanceReminderSent: true });
      
      reminderCount++;
    }
  }

  if (reminderCount > 0) {
    console.log(`✅ [CRON ATTENDANCE] Đã gửi ${reminderCount} email nhắc nhở điểm danh`);
  }
};

// Hàm gửi email nhắc nhở điểm danh cho GIÁO VIÊN
const sendAttendanceReminderToInstructor = async (booking) => {
  const classDateStr = new Date(booking.date).toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });

  const title = '⏰ Nhắc nhở: Buổi học chưa được điểm danh';
  const message = `Kính gửi Quý Thầy/Cô,

Buổi học ngày ${classDateStr} ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot} đã kết thúc nhưng Thầy/Cô chưa thực hiện điểm danh.

Vui lòng điểm danh ngay để hoàn tất buổi học.

Thông tin buổi học:
- Ngày: ${classDateStr}
- Ca: ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot}
- Học viên: ${booking.studentId?.fullName || 'N/A'}
- SĐT học viên: ${booking.studentId?.phone || 'N/A'}

Truy cập hệ thống để điểm danh: https://drivecenter.com/portal/instructor-schedule

Trân trọng!`;

  if (booking.instructorId?.email) {
    try {
      await sendNotificationEmail(booking.instructorId.email, title, message);
      console.log(`✅ [CRON] Đã gửi email nhắc điểm danh cho giáo viên: ${booking.instructorId.fullName}`);
    } catch (error) {
      console.error(`❌ [CRON] Lỗi gửi email cho giáo viên:`, error.message);
    }
  }
};

// Hàm gửi email nhắc nhở điểm danh cho HỌC VIÊN
const sendAttendanceReminderToStudent = async (booking) => {
  const classDateStr = new Date(booking.date).toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });

  const title = '⏰ Nhắc nhở: Buổi học chưa được điểm danh';
  const message = `Kính gửi Học viên,

Buổi học ngày ${classDateStr} ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot} đã kết thúc nhưng chưa được điểm danh.

Vui lòng liên hệ giáo viên hoặc kiểm tra lịch học để được điểm danh.

Thông tin buổi học:
- Ngày: ${classDateStr}
- Ca: ${SLOT_LABELS[String(booking.timeSlot)] || 'Ca ' + booking.timeSlot}
- Giáo viên: ${booking.instructorId?.fullName || 'N/A'}
- SĐT giáo viên: ${booking.instructorId?.phone || 'N/A'}

Truy cập hệ thống để xem lịch: https://drivecenter.com/portal/schedule

Trân trọng!`;

  if (booking.studentId?.email) {
    try {
      await sendNotificationEmail(booking.studentId.email, title, message);
      console.log(`✅ [CRON] Đã gửi email nhắc điểm danh cho học viên: ${booking.studentId.fullName}`);
    } catch (error) {
      console.error(`❌ [CRON] Lỗi gửi email cho học viên:`, error.message);
    }
  }
};

// Hàm gửi email nhắc nhở điểm danh (gửi cho cả GV và HV)
const sendAttendanceReminderEmail = async (booking) => {
  // Gửi email cho giáo viên
  await sendAttendanceReminderToInstructor(booking);
  
  // Gửi email cho học viên
  await sendAttendanceReminderToStudent(booking);
};

// Hàm gửi thông báo nhắc nhở giáo viên đăng ký lịch bận
const sendInstructorBusyScheduleReminder = async () => {
  // Tìm tất cả giáo viên (INSTRUCTOR)
  const instructors = await User.find({ role: 'INSTRUCTOR' });
  
  if (instructors.length === 0) {
    console.log('⚠️ [CRON] Không có giáo viên nào để gửi thông báo');
    return;
  }

  // Tính deadline (18:00 thứ 6)
  const now = new Date();
  const friday = new Date(now);
  const currentDay = now.getDay();
  const diffToFriday = 5 - currentDay;
  friday.setDate(now.getDate() + diffToFriday);
  friday.setHours(18, 0, 0, 0); // 18:00 thứ 6

  const deadlineStr = friday.toLocaleDateString('vi-VN', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const notificationTitle = '⏰ Nhắc nhở: Đăng ký lịch bận tuần sau';
  const notificationMessage = `Kính gửi Quý Thầy/Cô,

Để chuẩn bị tốt cho tuần học tới, xin vui lòng đăng ký lịch bận (nếu có) trước ${deadlineStr}.

Sau thời gian này, hệ thống sẽ tự động mở lịch trống để học viên đăng ký.

Vui lòng đăng nhập vào hệ thống để đăng ký lịch bận.

Truy cập hệ thống: https://drivecenter.com/portal/instructor-schedule

Trân trọng!`;

  // Tạo notification cho từng giáo viên và gửi email riêng
  for (const instructor of instructors) {
    // Tạo notification
    try {
      const notification = new Notification({
        userId: instructor._id,
        type: 'REMINDER',
        title: notificationTitle,
        message: notificationMessage,
        expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRead: false,
      });
      
      await notification.save();
      console.log(`✅ [CRON] Đã tạo thông báo cho giáo viên: ${instructor.fullName}`);
    } catch (error) {
      console.error(`❌ [CRON] Lỗi tạo thông báo cho ${instructor.fullName}:`, error.message);
    }

    // Gửi email riêng cho từng giáo viên
    if (instructor.email) {
      try {
        await sendNotificationEmail(instructor.email, notificationTitle, notificationMessage);
        console.log(`✅ [CRON] Đã gửi email nhắc nhở lịch bận cho giáo viên: ${instructor.email}`);
      } catch (error) {
        console.error(`❌ [CRON] Lỗi gửi email cho ${instructor.fullName}:`, error.message);
      }
    }
  }

  console.log(`🔔 [CRON] Hoàn tất gửi thông báo cho ${instructors.length} giáo viên`);
};

export default { startFridayReminderCron, startAttendanceReminderCron };
