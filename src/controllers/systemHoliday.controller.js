import SystemHoliday from '../models/SystemHoliday.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Schedule from '../models/Schedule.js';
import { sendNotificationEmail } from '../services/email.service.js';
import { emitScheduleUpdate } from '../services/socket.service.js';

// Helper: Gửi email thông báo lịch nghỉ
// - Toàn hệ thống: gửi cho tất cả INSTRUCTOR + learner + SALES
// - Theo khu vực: gửi cho INSTRUCTOR (workingLocation) + learner (registration batch location) + SALES của khu vực đó
const sendHolidayNotification = async (holiday, action = 'CREATE', excludeEmails = []) => {
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
      // Toàn hệ thống: tất cả INSTRUCTOR + learner + SALES
      const allUsers = await User.find({
        email: { $exists: true, $ne: '' },
        role: { $in: ['INSTRUCTOR', 'learner', 'SALES'] }
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
      
      // Lấy learner đăng ký các batch này
      const learnersInBatches = await Registration.find({
        batchId: { $in: batchIdsInLocation },
        status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
      }).distinct('learnerId');
      learnersInBatches.forEach(id => targetUserIds.add(id.toString()));
    }

    // Lấy thông tin email của các user (loại trừ những người đã nhận email thông báo huỷ ca cụ thể)
    const users = await User.find({
      _id: { $in: [...targetUserIds] },
      email: { $exists: true, $ne: '', $nin: excludeEmails }
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
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const holidays = await SystemHoliday.find()
      .sort({ startDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await SystemHoliday.countDocuments();

    res.json({
      status: 'success',
      data: holidays,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
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

    const startObj = new Date(startDate);
    startObj.setHours(0, 0, 0, 0);
    const endObj = new Date(endDate);
    endObj.setHours(23, 59, 59, 999);

    // [MỚI] Kiểm tra trùng lặp lịch nghỉ (Overlap Validation)
    // Nếu tạo lịch "Toàn hệ thống" (location=null) -> CHỈ trùng với lịch Toàn hệ thống khác (không bị chặn bởi lịch khu vực)
    // Nếu tạo lịch "Khu vực X" -> bị chặn bởi lịch "Toàn hệ thống" HOẶC lịch "Khu vực X"
    const locationFilter = location 
      ? { $or: [{ location: null }, { location }] }
      : { location: null };

    const existingHoliday = await SystemHoliday.findOne({
      startDate: { $lte: endObj },
      endDate: { $gte: startObj },
      ...locationFilter,
      isActive: true // Chỉ check các lịch nghỉ đang active
    });

    if (existingHoliday) {
      return res.status(400).json({
        status: 'error',
        message: `Lịch nghỉ này bị trùng lặp thời gian với lịch nghỉ: "${existingHoliday.title}" (${existingHoliday.location || 'Toàn hệ thống'}). Vui lòng chọn ngày khác.`
      });
    }

    const holiday = new SystemHoliday({
      title,
      startDate: startObj,
      endDate: endObj,
      description,
      location: location || null // null = toàn hệ thống
    });

    await holiday.save();

    // =============== [MỚI] HUỶ CÁC CA HỌC BỊ TRÙNG VỚI LỊCH NGHỈ ===============

    // 1. Tìm các giáo viên bị ảnh hưởng bởi khu vực nghỉ lễ
    let affectedInstructorIds = [];
    if (!location) {
      const allInst = await User.find({ role: 'INSTRUCTOR' }).select('_id');
      affectedInstructorIds = allInst.map(u => u._id);
    } else {
      const areaInst = await User.find({ 
        role: 'INSTRUCTOR',
        workingLocation: { $regex: new RegExp(`^${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id');
      affectedInstructorIds = areaInst.map(u => u._id);
    }

    // 2. Tìm tất cả booking trong khoảng thời gian đó của các giáo viên trên
    const affectedBookings = await Booking.find({
      date: { $gte: startObj, $lte: endObj },
      instructorId: { $in: affectedInstructorIds }
    }).populate('learnerId', 'email fullName').populate('instructorId', 'email fullName');

    const cancelledLearners = new Map(); // Dùng Map để tránh gửi 2 email cho 1 học viên bị huỷ 2 ca
    const cancelledInstructors = new Map();

    // 3. Thực hiện huỷ và lưu thông tin
    for (const booking of affectedBookings) {
      booking.status = 'CANCELLED';
      booking.instructorNote = `Huỷ do lịch nghỉ lễ: ${title}`;
      await booking.save();

      if (booking.learnerId?.email) {
        cancelledLearners.set(booking.learnerId.email, booking.learnerId.fullName);
      }
      if (booking.instructorId?.email) {
        cancelledInstructors.set(booking.instructorId.email, booking.instructorId.fullName);
      }
    }

    // [MỚI] Xoá lịch báo bận của giáo viên trong khu vực / khoảng thời gian này
    await Schedule.deleteMany({
      date: { $gte: startObj, $lte: endObj },
      instructorId: { $in: affectedInstructorIds }
    });

    // [MỚI] Kích hoạt Realtime cập nhật lịch nghỉ lễ cho toàn bộ phía học viên & giáo viên
    emitScheduleUpdate({ status: 'HOLIDAY_CREATED', location: holiday.location });

    // [MỚI] Trả về response NGAY LẬP TỨC để tránh timeout trên màn hình Admin
    res.status(201).json({ status: 'success', data: holiday });

    // 4. Gửi email chuyên biệt và chung - CHẠY NGẦM BACKGROUND
    (async () => {
      try {
        for (const [email, name] of cancelledLearners.entries()) {
          await sendNotificationEmail(
            email,
            `🔔 Thông báo: Huỷ lịch học do lịch nghỉ lễ - ${title}`,
            `Kính gửi Học viên ${name},

Lịch học của bạn trong khoảng thời gian từ ${startObj.toLocaleDateString('vi-VN')} đến ${endObj.toLocaleDateString('vi-VN')} đã bị hệ thống huỷ tự động do trung tâm có lịch nghỉ: ${title}.

Vui lòng truy cập hệ thống để đăng ký lại lịch học vào ngày khác.

Trân trọng!`
          ).catch(e => console.error(e));
        }

        for (const [email, name] of cancelledInstructors.entries()) {
          await sendNotificationEmail(
            email,
            `🔔 Thông báo: Huỷ lịch dạy do lịch nghỉ lễ - ${title}`,
            `Kính gửi Thầy/Cô ${name},

Các lịch dạy của Thầy/Cô trong khoảng thời gian từ ${startObj.toLocaleDateString('vi-VN')} đến ${endObj.toLocaleDateString('vi-VN')} đã bị huỷ tự động do hệ thống có lịch nghỉ: ${title}.

Trân trọng!`
          ).catch(e => console.error(e));
        }

        // Loại trừ những người vừa nhận email huỷ ca khỏi danh sách nhận email thông báo chung
        const excludeEmails = [...cancelledLearners.keys(), ...cancelledInstructors.keys()];

        // Gửi email thông báo chung cho các đối tượng CÒN LẠI không có lịch học
        await sendHolidayNotification(holiday, 'CREATE', excludeEmails);
      } catch (bgError) {
        console.error('Background holiday email error:', bgError);
      }
    })();

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: error.message });
    } else {
      console.error('Lỗi Holiday Controller (Outer Block):', error);
    }
  }
};

// 3. Cập nhật lịch nghỉ
export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, startDate, endDate, description, isActive, location } = req.body;

    const existingTargetHoliday = await SystemHoliday.findById(id);
    if (!existingTargetHoliday) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy lịch nghỉ' });
    }

    const startObj = startDate ? new Date(startDate) : existingTargetHoliday.startDate;
    const endObj = endDate ? new Date(endDate) : existingTargetHoliday.endDate;
    const loc = location !== undefined ? (location || null) : existingTargetHoliday.location;

    // Validate: endDate >= startDate
    if (new Date(endObj) < new Date(startObj)) {
      return res.status(400).json({
        status: 'error',
        message: 'Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu'
      });
    }

    startObj.setHours(0, 0, 0, 0);
    endObj.setHours(23, 59, 59, 999);

    // [MỚI] Overlap Validation cho Update Lịch nghỉ
    const locationFilter = loc 
      ? { $or: [{ location: null }, { location: loc }] }
      : { location: null }; // Toàn hệ thống chỉ check trùng với Toàn hệ thống khác

    const overlappingHoliday = await SystemHoliday.findOne({
      _id: { $ne: id },
      startDate: { $lte: endObj },
      endDate: { $gte: startObj },
      ...locationFilter,
      isActive: true
    });

    if (overlappingHoliday) {
      return res.status(400).json({
        status: 'error',
        message: `Cập nhật thất bại: Trùng lặp thời gian với lịch nghỉ tĩnh: "${overlappingHoliday.title}" (${overlappingHoliday.location || 'Toàn hệ thống'}). Vui lòng chọn ngày khác.`
      });
    }

    const updateData = { title, description, isActive };
    if (startDate) updateData.startDate = startObj;
    if (endDate) updateData.endDate = endObj;
    if (location !== undefined) updateData.location = loc;

    const holiday = await SystemHoliday.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    // =============== [MỚI] HUỶ CÁC CA HỌC BỊ TRÙNG KHI UPDATE LỊCH NGHỈ ===============
    let affectedInstructorIds = [];
    if (!loc) {
      const allInst = await User.find({ role: 'INSTRUCTOR' }).select('_id');
      affectedInstructorIds = allInst.map(u => u._id);
    } else {
      const areaInst = await User.find({ 
        role: 'INSTRUCTOR',
        workingLocation: { $regex: new RegExp(`^${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).select('_id');
      affectedInstructorIds = areaInst.map(u => u._id);
    }

    const affectedBookings = await Booking.find({
      date: { $gte: startObj, $lte: endObj },
      instructorId: { $in: affectedInstructorIds }
    }).populate('learnerId', 'email fullName').populate('instructorId', 'email fullName');

    const cancelledLearners = new Map();
    const cancelledInstructors = new Map();

    for (const booking of affectedBookings) {
      booking.status = 'CANCELLED';
      booking.instructorNote = `Huỷ do dời mốc lịch nghỉ lễ: ${title}`;
      await booking.save();

      if (booking.learnerId?.email) {
        cancelledLearners.set(booking.learnerId.email, booking.learnerId.fullName);
      }
      if (booking.instructorId?.email) {
        cancelledInstructors.set(booking.instructorId.email, booking.instructorId.fullName);
      }
    }

    // Xoá lịch báo bận của giáo viên
    await Schedule.deleteMany({
      date: { $gte: startObj, $lte: endObj },
      instructorId: { $in: affectedInstructorIds }
    });

    // Kích hoạt Realtime
    emitScheduleUpdate({ status: 'HOLIDAY_UPDATED', location: holiday.location });

    res.json({ status: 'success', data: holiday });

    // Gửi email thông báo cập nhật CHẠY NGẦM BACKGROUND
    (async () => {
      try {
        for (const [email, name] of cancelledLearners.entries()) {
          await sendNotificationEmail(
            email,
            `🔔 Thông báo: Huỷ lịch học do thay đổi ngày lịch nghỉ lễ - ${title}`,
            `Kính gửi Học viên ${name},\n\nLịch học của bạn trong khoảng thời gian từ ${startObj.toLocaleDateString('vi-VN')} đến ${endObj.toLocaleDateString('vi-VN')} đã bị huỷ tự động do thay đổi mốc lịch nghỉ lễ: ${title}.\n\nVui lòng truy cập hệ thống để đăng ký lại lịch học vào ngày khác.\n\nTrân trọng!`
          ).catch(e => console.error(e));
        }

        for (const [email, name] of cancelledInstructors.entries()) {
          await sendNotificationEmail(
            email,
            `🔔 Thông báo: Huỷ lịch dạy do dời lịch nghỉ - ${title}`,
            `Kính gửi Thầy/Cô ${name},\n\nCác lịch dạy của Thầy/Cô trong khoảng thời gian từ ${startObj.toLocaleDateString('vi-VN')} đến ${endObj.toLocaleDateString('vi-VN')} đã bị huỷ do hệ thống thay đổi lịch nghỉ: ${title}.\n\nTrân trọng!`
          ).catch(e => console.error(e));
        }

        const excludeEmails = [...cancelledLearners.keys(), ...cancelledInstructors.keys()];
        await sendHolidayNotification(holiday, 'UPDATE', excludeEmails);
      } catch (e) {
        console.error('BG Email Warning:', e);
      }
    })();

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: error.message });
    }
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

    // Kích hoạt Realtime
    emitScheduleUpdate({ status: 'HOLIDAY_DELETED', location: holiday.location });

    // Sau đó mới xóa
    await SystemHoliday.findByIdAndDelete(id);

    res.json({ status: 'success', message: 'Xóa lịch nghỉ thành công' });

    // Gửi email thông báo xóa chạy ngầm
    (async () => {
      await sendHolidayNotification(holiday, 'DELETE').catch(e => console.error('BG Email Warning:', e));
    })();

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', message: error.message });
    }
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
