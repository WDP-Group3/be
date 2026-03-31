import cron from 'node-cron';
import Notification from '../models/Notification.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Schedule from '../models/Schedule.js';
import Request from '../models/Request.js';
import { sendNotificationEmail } from './email.service.js';

// [CRON JOB] Gửi thông báo nhắc nhở giáo viên đăng ký lịch bận
// Chạy vào lúc 17:30 thứ 4 và thứ 6 hàng tuần
export const startFridayReminderCron = () => {
  console.log('📅 Cron job "Friday Reminder" đã được khởi động - Chạy lúc 17:30 thứ 4 và thứ 6 hàng tuần');

  // Cron expression: giây phút giờ ngày tháng thứ
  // 30 17 * * 4 = 17:30 thứ 4 (Wednesday)
  // 30 17 * * 5 = 17:30 thứ 6 (Friday)
  
  // Gửi nhắc vào thứ 4 (trước deadline 2 ngày)
  cron.schedule('30 17 * * 4', async () => {
    console.log('🔔 [CRON] Đang gửi thông báo nhắc nhở giáo viên đăng ký lịch bận (thứ 4)...');
    
    try {
      await sendInstructorBusyScheduleReminder('Thứ 4');
    } catch (error) {
      console.error('❌ [CRON] Lỗi khi gửi thông báo nhắc nhở (thứ 4):', error);
    }
  });

  // Gửi nhắc vào thứ 6 (ngày deadline)
  cron.schedule('30 17 * * 5', async () => {
    console.log('🔔 [CRON] Đang gửi thông báo nhắc nhở giáo viên đăng ký lịch bận (thứ 6 - deadline)...');
    
    try {
      await sendInstructorBusyScheduleReminder('Thứ 6');
    } catch (error) {
      console.error('❌ [CRON] Lỗi khi gửi thông báo nhắc nhở (thứ 6):', error);
    }
  });
};

// [CRON JOB] Kiểm tra và gửi email nhắc nhở điểm danh
// Các ca học kết thúc lúc :00, chạy cron vào 5 phút sau mỗi 1 tiếng đồng hồ
export const startAttendanceReminderCron = () => {
  console.log('⏰ Cron job "Attendance Reminder" đã được khởi động - Chạy lúc phút 05 của mỗi giờ');

  // Chạy chính xác vào phút thứ 05 của mọi giờ
  cron.schedule('5 * * * *', async () => {
    console.log('🔔 [CRON ATTENDANCE] Đang kiểm tra các buổi học cần điểm danh (mỗi 1h)...');
    
    try {
      await checkAndSendAttendanceReminders();
    } catch (error) {
      console.error('❌ [CRON ATTENDANCE] Lỗi khi kiểm tra điểm danh:', error);
    }
  });
};

// [CRON JOB] Nhắc nhở Admin xử lý các đơn từ bị tồn đọng quá 24h
export const startPendingRequestsReminderCron = () => {
  console.log('⏰ Cron job "Admin Request Reminder" đã được khởi động - Chạy lúc 08:00 sáng mỗi ngày');

  // Chạy lúc 08:00 sáng mỗi ngày
  cron.schedule('0 8 * * *', async () => {
    console.log('🔔 [CRON ADMIN] Đang kiểm tra các đơn từ tồn đọng quá 24h...');
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const count = await Request.countDocuments({
        status: 'PENDING',
        createdAt: { $lte: twentyFourHoursAgo }
      });

      if (count > 0) {
        const admins = await User.find({ role: 'ADMIN' });
        for (const admin of admins) {
          if (admin.email) {
            await sendNotificationEmail(
              admin.email,
              '⚠️ NHẮC NHỞ QUAN TRỌNG: Đơn từ/Yêu cầu chưa xử lý',
              `Kính gửi Admin ${admin.fullName},

Hệ thống ghi nhận hiện đang có ${count} đơn từ đã tồn đọng HƠN 24 GIỜ nhưng chưa được phê duyệt hoặc từ chối.

Sự chậm trễ này có thể làm ảnh hưởng lớn đến thời khóa biểu và việc đóng phí của học viên và giáo viên.

Vui lòng truy cập Hệ thống Quản trị -> mục Sinh viên - Đơn từ để giải quyết ngay lập tức.

Trân trọng!`
            ).catch(e => console.error('Lỗi khi gửi email Admin:', e));
          }
        }
        console.log(`✅ [CRON ADMIN] Đã gửi thông báo nhắc admin xử lý ${count} đơn từ tồn đọng.`);
      }
    } catch (error) {
      console.error('❌ [CRON ADMIN] Lỗi khi kiểm tra đơn từ tồn đọng:', error);
    }
  });
};

// Thời gian kết thúc các ca học (theo frontend: 10 ca)
const SLOT_END_TIMES = {
  "1": { hour: 8, minute: 0 },    // Ca 1: 07:00-08:00
  "2": { hour: 9, minute: 0 },    // Ca 2: 08:00-09:00
  "3": { hour: 10, minute: 0 },   // Ca 3: 09:00-10:00
  "4": { hour: 11, minute: 0 },   // Ca 4: 10:00-11:00
  "5": { hour: 12, minute: 0 },   // Ca 5: 11:00-12:00
  "6": { hour: 14, minute: 0 },   // Ca 6: 13:00-14:00
  "7": { hour: 15, minute: 0 },   // Ca 7: 14:00-15:00
  "8": { hour: 16, minute: 0 },   // Ca 8: 15:00-16:00
  "9": { hour: 17, minute: 0 },   // Ca 9: 16:00-17:00
  "10": { hour: 18, minute: 0 },  // Ca 10: 17:00-18:00
};

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
  }).populate('learnerId', 'fullName email phone')
    .populate('instructorId', 'fullName email phone');

  let reminderCount = 0;

  for (const booking of bookings) {
    const { hour, minute } = SLOT_END_TIMES[String(booking.timeSlot)] || { hour: 17, minute: 0 };
    
    // [FIX] Tính thời điểm kết thúc ca học tuyệt đối theo múi giờ Việt Nam (UTC+7)
    // Chống trôi múi giờ nếu máy chủ chạy UTC thay vì Local ICT
    const vietnamDate = new Date(booking.date.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    const classYear = vietnamDate.getFullYear();
    const classMonth = String(vietnamDate.getMonth() + 1).padStart(2, '0');
    const classDateStr = String(vietnamDate.getDate()).padStart(2, '0');
    const classHrStr = String(hour).padStart(2, '0');
    const classMnStr = String(minute).padStart(2, '0');
    
    const absoluteEndTimeStr = `${classYear}-${classMonth}-${classDateStr}T${classHrStr}:${classMnStr}:00+07:00`;
    const classEndTime = new Date(absoluteEndTimeStr);
    
    const reminderTime = new Date(classEndTime.getTime() + 5 * 60 * 1000); // +5 phút
    const now = new Date();

    // Nếu đã đến hoặc qua thời điểm kết thúc + 5 phút
    if (now >= reminderTime) {
      // Đánh dấu đã gửi (Khóa ngay cờ này TRƯỚC KHI thực hiện gửi email để chống Race Condition)
      await Booking.findByIdAndUpdate(booking._id, { attendanceReminderSent: true });

      // Gửi email nhắc nhở cho cả giáo viên và học viên
      await sendAttendanceReminderEmail(booking).catch(e => console.error('Lỗi gửi email điểm danh ngầm:', e));
      
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
- Học viên: ${booking.learnerId?.fullName || 'N/A'}
- SĐT học viên: ${booking.learnerId?.phone || 'N/A'}

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
const sendAttendanceReminderTolearner = async (booking) => {
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

  if (booking.learnerId?.email) {
    try {
      await sendNotificationEmail(booking.learnerId.email, title, message);
      console.log(`✅ [CRON] Đã gửi email nhắc điểm danh cho học viên: ${booking.learnerId.fullName}`);
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
  await sendAttendanceReminderTolearner(booking);
};

// Hàm gửi thông báo nhắc nhở giáo viên đăng ký lịch bận
// dayOfWeek: 'Thứ 4' hoặc 'Thứ 6' để tùy biến nội dung
export const sendInstructorBusyScheduleReminder = async (dayOfWeek = 'Thứ 6') => {
  // Tính ngày bắt đầu và kết thúc của tuần sau
  const now = new Date();
  const nextWeekMonday = new Date(now);
  nextWeekMonday.setDate(now.getDate() + (7 - now.getDay() + 1)); // Thứ 2 tuần sau
  nextWeekMonday.setHours(0, 0, 0, 0);
  
  const nextWeekSunday = new Date(nextWeekMonday);
  nextWeekSunday.setDate(nextWeekMonday.getDate() + 6); // Chủ nhật tuần sau
  
  // Tìm tất cả giáo viên (INSTRUCTOR)
  const instructors = await User.find({ role: 'INSTRUCTOR' });
  
  if (instructors.length === 0) {
    console.log('⚠️ [CRON] Không có giáo viên nào để gửi thông báo');
    return;
  }

  // Lọc chỉ giáo viên CHƯA có lịch bận tuần sau
  const instructorsWithoutSchedule = [];
  
  for (const instructor of instructors) {
    // Kiểm tra xem giáo viên đã có lịch bận tuần sau chưa
    const existingSchedule = await Schedule.findOne({
      instructorId: instructor._id,
      date: {
        $gte: nextWeekMonday,
        $lte: nextWeekSunday
      },
      isBusy: true
    });
    
    if (!existingSchedule) {
      instructorsWithoutSchedule.push(instructor);
    }
  }
  
  if (instructorsWithoutSchedule.length === 0) {
    console.log('⚠️ [CRON] Tất cả giáo viên đã có lịch bận tuần sau, không cần gửi thông báo');
    return;
  }
  
  console.log(`📧 [CRON] Tìm thấy ${instructorsWithoutSchedule.length}/${instructors.length} giáo viên chưa có lịch bận tuần sau`);

  // Tính deadline (18:00 thứ 6)
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

  // Tùy biến nội dung theo ngày gửi
  let notificationTitle, notificationMessage;
  
  if (dayOfWeek === 'Thứ 4') {
    notificationTitle = '⏰ Nhắc nhở: Đăng ký lịch bận tuần sau';
    notificationMessage = `Kính gửi Quý Thầy/Cô,

Tuần học mới sắp bắt đầu! Để chuẩn bị tốt, xin vui lòng đăng ký lịch bận (nếu có) TRƯỚC ${deadlineStr} (18:00 thứ 6).

Sau thời gian này, hệ thống sẽ tự động mở lịch trống để học viên đăng ký.

Vui lòng đăng nhập vào hệ thống để đăng ký lịch bận.

Truy cập hệ thống: https://drivecenter.com/portal/instructor-schedule

Trân trọng!`;
  } else {
    notificationTitle = '⏰ NHẮC GẤP: Deadline đăng ký lịch bận - 18:00 hôm nay!';
    notificationMessage = `Kính gửi Quý Thầy/Cô,

Hôm nay là ${dayOfWeek} - DEADLINE đăng ký lịch bận cho tuần sau!

Vui lòng đăng ký lịch bận (nếu có) TRƯỚC 18:00 HÔM NAY.

Sau thời gian này, hệ thống sẽ tự động mở lịch trống để học viên đăng ký.

Vui lòng đăng nhập vào hệ thống để đăng ký lịch bận NGAY.

Truy cập hệ thống: https://drivecenter.com/portal/instructor-schedule

Trân trọng!`;
  }

  // Tạo notification cho từng giáo viên và gửi email riêng
  for (const instructor of instructorsWithoutSchedule) {
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

  console.log(`🔔 [CRON] Hoàn tất gửi thông báo cho ${instructorsWithoutSchedule.length} giáo viên`);
};

export default { startFridayReminderCron, startAttendanceReminderCron };
