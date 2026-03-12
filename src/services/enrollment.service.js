import Registration from '../models/Registration.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import Payment from '../models/Payment.js';

/**
 * Service xử lý tự động gán học viên vào lớp học
 */

/**
 * Tự động gán học viên vào lớp học dựa trên số lượng tối đa
 * @param {String} courseId - ID của khoá học
 * @returns {Object} Kết quả gán học viên
 */
export const autoEnrollStudents = async (courseId, options = {}) => {
  const { batchId: targetBatchId } = options;
  try {
    // 1. Lấy thông tin khoá học
    const course = await Course.findById(courseId);
    if (!course) {
      return { success: false, message: 'Không tìm thấy khoá học' };
    }

    // 2. Tìm batch phù hợp
    let batch = null;
    if (targetBatchId) {
      batch = await Batch.findOne({
        _id: targetBatchId,
        courseId,
        status: 'OPEN'
      });

      if (!batch) {
        console.log(`⚠️ [AUTO-ENROLL] Batch ${targetBatchId} không tồn tại hoặc đã đóng. Chuyển sang batch khác.`);
      }
    }

    if (!batch) {
      batch = await Batch.findOne({
        courseId,
        status: 'OPEN'
      }).sort({ startDate: 1 });
    }

    if (!batch) {
      const defaultStartDate = new Date();
      defaultStartDate.setDate(defaultStartDate.getDate() + 7);

      const defaultEndDate = new Date(defaultStartDate);
      defaultEndDate.setMonth(defaultEndDate.getMonth() + 3);

      batch = await Batch.create({
        courseId,
        startDate: defaultStartDate,
        estimatedEndDate: defaultEndDate,
        location: course.location?.[0] || 'Hà Nội',
        status: 'OPEN',
        instructorIds: []
      });
      console.log(`✅ [AUTO-ENROLL] Đã tạo batch mới cho khoá học: ${course.name}`);
    }

    const maxStudents = batch.maxStudents || course.maxStudents || 50;

    // 3. Tính số slot còn trống
    const enrolledCount = await Registration.countDocuments({
      batchId: batch._id,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
    });

    const openSlots = Math.max(maxStudents - enrolledCount, 0);
    if (openSlots <= 0) {
      console.log(`⚠️ [AUTO-ENROLL] Lớp học ${batch.name || course.name} đã đầy (${enrolledCount}/${maxStudents})`);
      return {
        success: false,
        message: `Lớp học đã đầy (${enrolledCount}/${maxStudents})`,
        enrolledCount,
        maxStudents,
        isFull: true,
        batchId: batch._id
      };
    }

    // 4. Tìm các đăng ký đã thanh toán và chờ vào lớp
    // Bao gồm: NEW (đã có batch), PROCESSING, WAITING (chưa có batch)
    const pendingRegistrations = await Registration.find({
      courseId,
      status: { $in: ['NEW', 'PROCESSING', 'WAITING'] },
      $or: [
        { batchId: { $in: [null, undefined] } }, // Chưa có batch
        { batchId: batch._id } // Có batch nhưng là batch hiện tại
      ]
    })
      .populate('studentId', 'fullName email')
      .sort({ createdAt: 1 });

    const pendingIds = pendingRegistrations.map((reg) => reg._id);
    if (!pendingIds.length) {
      console.log(`ℹ️ [AUTO-ENROLL] Không có học viên chờ của khoá học ${course.name}`);
      return {
        success: true,
        message: 'Không có học viên chờ được gán',
        enrolledCount,
        maxStudents,
        newlyEnrolled: 0,
        batchId: batch._id
      };
    }

    const paidRegistrationIds = await Payment.distinct('registrationId', {
      registrationId: { $in: pendingIds }
    });
    const paidSet = new Set(paidRegistrationIds.map((id) => String(id)));

    // 5. Lọc các registration đủ điều kiện và cắt giới hạn chỗ trống
    const readyToEnroll = pendingRegistrations
      .filter((reg) => paidSet.has(String(reg._id)))
      .slice(0, openSlots);

    if (readyToEnroll.length === 0) {
      console.log(`ℹ️ [AUTO-ENROLL] Không tìm thấy học viên đã thanh toán để gán vào lớp ${course.name}`);
      return {
        success: true,
        message: 'Không có học viên đã thanh toán để gán',
        enrolledCount,
        maxStudents,
        newlyEnrolled: 0,
        batchId: batch._id
      };
    }

    // 6. Gán các HV vào batch
    const newlyEnrolled = [];
    for (const reg of readyToEnroll) {
      await Registration.findByIdAndUpdate(reg._id, {
        batchId: batch._id,
        courseId,
        status: 'PROCESSING'
      });

      newlyEnrolled.push({
        registrationId: reg._id,
        studentName: reg.studentId?.fullName,
        studentEmail: reg.studentId?.email
      });

      console.log(`✅ [AUTO-ENROLL] Đã gán HV ${reg.studentId?.fullName} vào lớp ${batch._id}`);
    }

    const newEnrolledCount = enrolledCount + newlyEnrolled.length;

    console.log(`🎉 [AUTO-ENROLL] Hoàn tất! Đã gán ${newlyEnrolled.length} học viên vào lớp ${batch.name || course.name} (${newEnrolledCount}/${maxStudents})`);

    return {
      success: true,
      message: `Đã gán ${newlyEnrolled.length} học viên vào lớp ${batch.name || "mới tạo"}`,
      enrolledCount: newEnrolledCount,
      maxStudents,
      newlyEnrolled,
      batchId: batch._id
    };

  } catch (error) {
    console.error('❌ [AUTO-ENROLL] Lỗi:', error.message);
    return { success: false, message: error.message };
  }
};

/**
 * Gán một học viên cụ thể vào lớp (khi HV thanh toán)
 * @param {String} registrationId - ID của đăng ký
 * @returns {Object} Kết quả gán
 */
export const enrollSingleStudent = async (registrationId) => {
  try {
    // 1. Lấy thông tin registration (đã populate batchId)
    const registration = await Registration.findById(registrationId)
      .populate({
        path: 'batchId',
        populate: { path: 'courseId' }
      });

    if (!registration) {
      return { success: false, message: 'Không tìm thấy đăng ký' };
    }

    // Nếu đã có batchId rồi thì bỏ qua
    if (registration.batchId) {
      return { success: true, message: 'Học viên đã được gán vào lớp trước đó', alreadyEnrolled: true };
    }

    // 2. Lấy courseId từ registration hoặc batch
    let courseId = registration.courseId;
    
    // Nếu không có courseId trong registration, lấy từ batch
    if (!courseId && registration.batchId?.courseId) {
      courseId = registration.batchId.courseId._id || registration.batchId.courseId;
    }

    if (!courseId) {
      return { success: false, message: 'Không xác định được khoá học' };
    }

    // 3. Lấy thông tin khoá học
    const course = await Course.findById(courseId);
    if (!course) {
      return { success: false, message: 'Không tìm thấy khoá học' };
    }

    // 4. Tìm hoặc tạo Batch
    let batch = await Batch.findOne({ 
      courseId, 
      status: 'OPEN' 
    });

    if (!batch) {
      const defaultStartDate = new Date();
      defaultStartDate.setDate(defaultStartDate.getDate() + 7);

      const defaultEndDate = new Date(defaultStartDate);
      defaultEndDate.setMonth(defaultEndDate.getMonth() + 3);

      batch = await Batch.create({
        courseId,
        startDate: defaultStartDate,
        estimatedEndDate: defaultEndDate,
        location: course.location?.[0] || 'Hà Nội',
        status: 'OPEN',
        instructorIds: []
      });
    }

    const maxStudents = batch.maxStudents || course.maxStudents || 50;

    // 5. Đếm số HV hiện tại
    const enrolledCount = await Registration.countDocuments({
      batchId: batch._id,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
    });

    // 6. Kiểm tra còn slot không
    if (enrolledCount >= maxStudents) {
      // Cập nhật trạng thái chờ
      await Registration.findByIdAndUpdate(registrationId, {
        status: 'WAITING',
        courseId: courseId
      });
      
      console.log(`⚠️ [AUTO-ENROLL] HV ${registration.studentId} vào danh sách chờ (lớp đã đầy)`);
      
      return {
        success: false,
        message: 'Lớp học đã đầy, bạn được thêm vào danh sách chờ',
        enrolledCount,
        maxStudents,
        isFull: true,
        waitingList: true
      };
    }

    // 7. Gán vào lớp
    await Registration.findByIdAndUpdate(registrationId, {
      batchId: batch._id,
      courseId: courseId,
      status: 'PROCESSING'
    });

    const newCount = enrolledCount + 1;

    console.log(`✅ [AUTO-ENROLL] Đã gán HV ${registration.studentId} vào lớp ${batch._id} (${newCount}/${maxStudents})`);

    return {
      success: true,
      message: 'Đã gán vào lớp thành công',
      enrolledCount: newCount,
      maxStudents,
      batchId: batch._id,
      waitingList: false
    };

  } catch (error) {
    console.error('❌ [AUTO-ENROLL] Lỗi gán HV đơn:', error.message);
    return { success: false, message: error.message };
  }
};
