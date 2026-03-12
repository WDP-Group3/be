import SystemHoliday from '../models/SystemHoliday.js';
import User from '../models/User.js';
import { sendNotificationEmail } from '../services/email.service.js';

// Helper: Gửi email thông báo lịch nghỉ cho tất cả giáo viên và học viên
const sendHolidayNotification = async (holiday, action = 'CREATE') => {
  try {
    const actionText = action === 'CREATE' ? 'tạo mới' : (action === 'UPDATE' ? 'cập nhật' : 'xóa');
    const startDateStr = new Date(holiday.startDate).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
    const endDateStr = new Date(holiday.endDate).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });

    const title = `📅 [${actionText === 'tạo mới' ? 'THÔNG BÁO' : 'CẬP NHẬT'}] Lịch nghỉ hệ thống - ${holiday.title}`;
    const message = `Kính gửi Quý Thầy/Cô và Học viên,

${actionText === 'tạo mới' ? 'Hệ thống thông báo về việc' : 'Hệ thống thông báo về việc đã'} ${actionText} lịch nghỉ toàn hệ thống như sau:

📌 Tên lịch nghỉ: ${holiday.title}
📅 Ngày bắt đầu: ${startDateStr}
📅 Ngày kết thúc: ${endDateStr}
${holiday.description ? `📝 Mô tả: ${holiday.description}` : ''}

⏰ Lưu ý:
- Trong thời gian nghỉ lễ này, toàn bộ lịch dạy và lịch học sẽ bị khóa.
- Giáo viên và học viên không thể thao tác đặt lịch/hủy lịch trong các ngày nghỉ lễ.
- Các buổi học đã đặt trước sẽ được hệ thống xử lý tự động.

Vui lòng theo dõi hệ thống để cập nhật thông tin mới nhất.

Trân trọng,
Ban Quản lý Drive Center`;

    // Lấy danh sách tất cả giáo viên và học viên có email
    const users = await User.find({
      email: { $exists: true, $ne: '' },
      role: { $in: ['INSTRUCTOR', 'STUDENT'] }
    }).select('email fullName role');

    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      if (user.email) {
        try {
          await sendNotificationEmail(user.email, title, message);
          successCount++;
        } catch (error) {
          console.error(`Failed to send email to ${user.email}:`, error.message);
          failCount++;
        }
      }
    }

    console.log(`📧 Holiday notification sent: ${successCount} success, ${failCount} failed`);
    return { successCount, failCount };
  } catch (error) {
    console.error('Error sending holiday notification:', error.message);
  }
};

// 1. Lấy tất cả lịch nghỉ
export const getAllHolidays = async (req, res) => {
  try {
    const holidays = await SystemHoliday.find().sort({ startDate: -1 });
    res.json({ status: 'success', data: holidays });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 2. Tạo lịch nghỉ mới
export const createHoliday = async (req, res) => {
  try {
    const { title, startDate, endDate, description } = req.body;

    // Validate: endDate >= startDate
    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({
        status: 'error',
        message: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu'
      });
    }

    const holiday = new SystemHoliday({
      title,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      description
    });

    await holiday.save();

    // Gửi email thông báo cho tất cả giáo viên và học viên
    await sendHolidayNotification(holiday, 'CREATE');

    res.status(201).json({ status: 'success', data: holiday });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 3. Cập nhật lịch nghỉ
export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, startDate, endDate, description, isActive } = req.body;

    // Validate: endDate >= startDate
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({
        status: 'error',
        message: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu'
      });
    }

    const holiday = await SystemHoliday.findByIdAndUpdate(
      id,
      { title, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined, description, isActive },
      { new: true, runValidators: true }
    );

    if (!holiday) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch nghỉ' });
    }

    // Gửi email thông báo cập nhật cho tất cả giáo viên và học viên
    await sendHolidayNotification(holiday, 'UPDATE');

    res.json({ status: 'success', data: holiday });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 4. Xóa lịch nghỉ
export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const holiday = await SystemHoliday.findById(id);

    if (!holiday) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch nghỉ' });
    }

    // Gửi email thông báo xóa cho tất cả giáo viên và học viên (trước khi xóa)
    await sendHolidayNotification(holiday, 'DELETE');

    // Sau đó mới xóa
    await SystemHoliday.findByIdAndDelete(id);

    res.json({ status: 'success', message: 'Xóa lịch nghỉ thành công' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 5. Helper: Kiểm tra ngày có trong lịch nghỉ không
export const checkIsHoliday = async (date) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const holiday = await SystemHoliday.findOne({
    startDate: { $lte: targetDate },
    endDate: { $gte: targetDate },
    isActive: true
  });

  return holiday;
};
