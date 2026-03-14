import SystemHoliday from '../models/SystemHoliday.js';
import User from '../models/User.js';
import { sendNotificationEmail } from '../services/email.service.js';

// Helper: Gửi email thông báo lịch nghỉ
// - Toàn hệ thống: gửi cho tất cả INSTRUCTOR + STUDENT + SALES
// - Theo khu vực: gửi cho INSTRUCTOR (workingLocation) + STUDENT (registration batch location) + SALES của khu vực đó
const sendHolidayNotification = async (holiday, action = 'CREATE') => {
  try {
    const actionText = action === 'CREATE' ? 'tạo mới' : (action === 'UPDATE' ? 'cập nhật' : 'xóa');
    const startDateStr = new Date(holiday.startDate).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
    const endDateStr = new Date(holiday.endDate).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
    const locationNote = holiday.location 
      ? `áp dụng cho khu vực: ${holiday.location}` 
      : 'áp dụng cho toàn hệ thống';

    const title = `📅 [${actionText === 'tạo mới' ? 'THÔNG BÁO' : 'CẬP NHẬT'}] Lịch nghỉ ${holiday.location ? `khu vực ${holiday.location}` : 'toàn hệ thống'} - ${holiday.title}`;
    const message = `Kính gửi Quý Thầy/Cô, Học viên và Sales,

${actionText === 'tạo mới' ? 'Hệ thống thông báo về việc' : 'Hệ thống thông báo về việc đã'} ${actionText} lịch nghỉ như sau:

📌 Tên lịch nghỉ: ${holiday.title}
📍 Phạm vi: ${locationNote}
📅 Ngày bắt đầu: ${startDateStr}
📅 Ngày kết thúc: ${endDateStr}
${holiday.description ? `📝 Mô tả: ${holiday.description}` : ''}

⏰ Lưu ý:
${holiday.location 
  ? `- Lịch nghỉ chỉ áp dụng cho khu vực ${holiday.location}. Các khu vực khác vẫn hoạt động bình thường.
- Giáo viên và học viên thuộc khu vực ${holiday.location} không thể đặt lịch/hủy lịch trong các ngày nghỉ.`
  : `- Trong thời gian nghỉ lễ này, toàn bộ lịch dạy và lịch học sẽ bị khóa.
- Giáo viên và học viên không thể thao tác đặt lịch/hủy lịch trong các ngày nghỉ lễ.`
}
- Các buổi học đã đặt trước sẽ được hệ thống xử lý tự động.

Vui lòng theo dõi hệ thống để cập nhật thông tin mới nhất.

Trân trọng,
Ban Quản lý Drive Center`;

    // Tìm người nhận email theo khu vực
    let targetUserIds = new Set();

    if (!holiday.location) {
      // Toàn hệ thống: tất cả INSTRUCTOR + STUDENT + SALES
      const allUsers = await User.find({
        email: { $exists: true, $ne: '' },
        role: { $in: ['INSTRUCTOR', 'STUDENT', 'SALES'] }
      }).select('_id');
      allUsers.forEach(u => targetUserIds.add(u._id.toString()));
    } else {
      // Theo khu vực:
      // 1. Giáo viên có workingLocation = khu vực đó
      const instructorsInLocation = await User.find({
        email: { $exists: true, $ne: '' },
        role: 'INSTRUCTOR',
        workingLocation: { $regex: new RegExp(`^${holiday.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id');
      instructorsInLocation.forEach(u => targetUserIds.add(u._id.toString()));

      // 2. Sales của khu vực đó (có thể lọc theo workingLocation hoặc một trường khác)
      const salesInLocation = await User.find({
        email: { $exists: true, $ne: '' },
        role: 'SALES',
        workingLocation: { $regex: new RegExp(`^${holiday.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id');
      salesInLocation.forEach(u => targetUserIds.add(u._id.toString()));

      // 3. Học viên có đăng ký khóa học thuộc khu vực đó
      // Lấy từ Registration -> Batch -> location hoặc LearningLocation
      const Registration = (await import('../models/Registration.js')).default;
      const Batch = (await import('../models/Batch.js')).default;
      const LearningLocation = (await import('../models/LearningLocation.js')).default;

      // Tìm batch thuộc khu vực
      const batchesInLocation = await Batch.find({
        location: { $regex: new RegExp(`^${holiday.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id');
      const batchIdsInLocation = batchesInLocation.map(b => b._id);

      // Hoặc tìm từ LearningLocation
      const learningLocs = await LearningLocation.find({
        areaName: { $regex: new RegExp(`^${holiday.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).lean();
      
      // Lấy student đăng ký các batch này
      const studentsInBatches = await Registration.find({
        batchId: { $in: batchIdsInLocation },
        status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
      }).distinct('studentId');
      studentsInBatches.forEach(id => targetUserIds.add(id.toString()));
    }

    // Lấy thông tin email của các user
    const users = await User.find({
      _id: { $in: [...targetUserIds] },
      email: { $exists: true, $ne: '' }
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

    console.log(`📧 Holiday notification (${holiday.location || 'all'}) sent: ${successCount} success, ${failCount} failed`);
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
    const { title, startDate, endDate, description, location } = req.body;

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
      description,
      location: location || null // null = toàn hệ thống
    });

    await holiday.save();

    // Gửi email thông báo cho đối tượng liên quan
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
    const { title, startDate, endDate, description, isActive, location } = req.body;

    // Validate: endDate >= startDate
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({
        status: 'error',
        message: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu'
      });
    }

    const updateData = { title, description, isActive };
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (location !== undefined) updateData.location = location || null;

    const holiday = await SystemHoliday.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!holiday) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch nghỉ' });
    }

    // Gửi email thông báo cập nhật
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

    // Gửi email thông báo xóa trước khi xóa
    await sendHolidayNotification(holiday, 'DELETE');

    // Sau đó mới xóa
    await SystemHoliday.findByIdAndDelete(id);

    res.json({ status: 'success', message: 'Xóa lịch nghỉ thành công' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 5. Helper: Kiểm tra ngày có trong lịch nghỉ không (hỗ trợ location)
// Trả về holiday nếu là ngày nghỉ, hoặc null
export const checkIsHoliday = async (date, location = null) => {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  // Ưu tiên kiểm tra theo location cụ thể trước
  if (location) {
    const locationHoliday = await SystemHoliday.findOne({
      location: { $regex: new RegExp(`^${String(location).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      startDate: { $lte: targetDate },
      endDate: { $gte: targetDate },
      isActive: true
    });
    if (locationHoliday) return locationHoliday;
  }

  // Sau đó kiểm tra lịch nghỉ toàn hệ thống (location: null)
  const systemHoliday = await SystemHoliday.findOne({
    location: null,
    startDate: { $lte: targetDate },
    endDate: { $gte: targetDate },
    isActive: true
  });

  return systemHoliday;
};
