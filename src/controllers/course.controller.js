import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Registration from '../models/Registration.js';
import Payment from '../models/Payment.js';
import User from '../models/User.js';
import { buildFeePlanSnapshot } from '../utils/feeHelper.js';
import { autoEnrolllearners } from '../services/enrollment.service.js';
import { sendNotificationEmail } from '../services/email.service.js';

/**
 * @desc    Lấy danh sách courses (Hỗ trợ phân trang, tìm kiếm, lọc)
 * @route   GET /api/courses
 * @access  Public
 */
export const getAllCourses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status;

    const query = {};

    // Tìm kiếm theo tên hoặc mã
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }

    // Lọc status
    if (status) {
      if (status !== "ALL") {
        query.status = status;
      }
    } else {
      // Mặc định chỉ lấy các khoá học Active (không bị ẩn)
      query.status = "Active";
    }

    const skip = (page - 1) * limit;

    const [courses, total] = await Promise.all([
      Course.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Course.countDocuments(query)
    ]);

    res.json({
      status: "success",
      data: courses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Lỗi server khi lấy danh sách khoá học',
      error: error.message,
    });
  }
};

/**
 * @desc    Lấy chi tiết course theo ID
 * @route   GET /api/courses/:id
 * @access  Public
 */
export const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    // Tìm theo _id của MongoDB hoặc field code (tuỳ logic của bạn)
    // Ở đây dùng findById (tìm theo _id)
    const course = await Course.findById(id);

    if (!course) {
      return res.status(404).json({
        status: 'error',
        message: `Không tìm thấy khoá học với ID: ${id}`,
      });
    }

    res.json({
      status: "success",
      data: course,
    });

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * @desc    Tạo course mới
 * @route   POST /api/courses
 * @access  Private (Admin/Staff)
 */
export const createCourse = async (req, res) => {
  try {
    // 1. Dùng đúng tên estimatedCost thay vì price
    const {
      code,
      name,
      estimatedCost,
      description,
      image,
      status,
      estimatedDuration,
      location,
      note,
      feePayments
    } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        status: 'error',
        message: 'Vui lòng cung cấp đầy đủ Mã (code) và Tên (name) khoá học'
      });
    }

    const existingCourse = await Course.findOne({ code });
    if (existingCourse) {
      return res.status(409).json({
        status: 'error',
        message: `Mã khoá học "${code}" đã tồn tại.`
      });
    }

    // 2. Tự động tính estimatedCost từ tổng các đợt nếu có feePayments
    const payments = feePayments || [];
    const computedCost =
      payments.length > 0
        ? payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
        : Number(estimatedCost) || 0;

    const newCourse = new Course({
      code,
      name,
      estimatedCost: computedCost,
      feePayments: payments,
      estimatedDuration,
      location: location || [],
      status: "Active",
      description,
      image,
      note,
    });

    await newCourse.save();

    // 3. Tự động gán học viên đã đăng ký (nếu có)
    const enrollResult = await autoEnrolllearners(newCourse._id);
    console.log('🎯 [COURSE CREATE] Kết quả auto-enroll:', enrollResult);

    res.status(201).json({
      status: 'success',
      message: 'Tạo khoá học thành công',
      data: newCourse,
      enrollment: enrollResult,
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

/**
 * @desc    Cập nhật course
 * @route   PUT /api/courses/:id
 * @access  Private (Admin)
 */
export const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;

    const updates = { ...req.body };

    const oldCourse = await Course.findById(id);
    if (!oldCourse) {
      return res.status(404).json({ status: "error", message: "Course not found" });
    }

    // Tự động tính lại estimatedCost từ tổng feePayments nếu có
    let newEstimatedCost = oldCourse.estimatedCost;
    if (Array.isArray(updates.feePayments) && updates.feePayments.length > 0) {
      newEstimatedCost = updates.feePayments.reduce(
        (sum, p) => sum + (Number(p.amount) || 0),
        0
      );
      updates.estimatedCost = newEstimatedCost;
    }

    // Cập nhật khoá học
    const course = await Course.findByIdAndUpdate(id, updates, { new: true });

    // Khi feePayments thay đổi, cập nhật cho các registration CHƯA nộp đợt 1
    // (firstPaymentDate === null nghĩa là chưa nộp bất kỳ đợt nào)
    const feePaymentsChanged = updates.feePayments != null;
    if (feePaymentsChanged) {
      const oldTotal = oldCourse.feePayments?.reduce((s, p) => s + (Number(p.amount) || 0), 0) || oldCourse.estimatedCost || 0;
      const newTotal = course.feePayments?.reduce((s, p) => s + (Number(p.amount) || 0), 0) || course.estimatedCost || 0;
      const hasPriceChange = oldTotal !== newTotal;
      const hasScheduleChange = feePaymentsChanged &&
        JSON.stringify(oldCourse.feePayments) !== JSON.stringify(course.feePayments);

      if (hasPriceChange || hasScheduleChange) {
        // Lấy tất cả registration CHƯA nộp tiền đợt nào (firstPaymentDate === null)
        const unpaidRegistrations = await Registration.find({
          courseId: id,
          firstPaymentDate: null,
        }).populate('learnerId', 'fullName email phone');

        for (const reg of unpaidRegistrations) {
          // Cập nhật lại feePlanSnapshot
          reg.feePlanSnapshot = buildFeePlanSnapshot(course, reg.paymentPlanType);
          await reg.save();

          // Gửi email thông báo cho học viên
          if (reg.learnerId?.email) {
            const learner = reg.learnerId;
            let message = '';

            if (hasPriceChange) {
              const oldCost = oldTotal;
              const newCost = newTotal;
              const diff = newCost - oldCost;
              message = `Học phí khóa học "${course.name}" đã được điều chỉnh.\n` +
                `Học phí cũ: ${oldCost.toLocaleString('vi-VN')} VND\n` +
                `Học phí mới: ${newCost.toLocaleString('vi-VN')} VND\n` +
                `${diff > 0 ? 'Tăng' : 'Giảm'}: ${Math.abs(diff).toLocaleString('vi-VN')} VND\n\n` +
                `Kế hoạch đóng phí đã được cập nhật. Vui lòng đăng nhập để xem chi tiết.`;
            } else {
              message = `Kế hoạch đóng phí khóa học "${course.name}" đã được cập nhật (thay đổi về số đợt hoặc ngày đóng tiền).\n` +
                `Vui lòng đăng nhập để xem kế hoạch mới.`;
            }

            await sendNotificationEmail(
              learner.email,
              `Thông báo thay đổi học phí - ${course.name}`,
              message
            );
          }
        }

        console.log(`[COURSE UPDATE] Đã cập nhật và thông báo ${unpaidRegistrations.length} học viên chưa nộp tiền`);
      }
    }

    res.json({
      status: "success",
      data: course,
      message: "Cập nhật khoá học thành công",
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

export const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Tìm các Registration liên quan đến khóa học này
    const registrations = await Registration.find({ courseId: id });

    // 2. Xóa các hồ sơ chưa đóng tiền đợt 1
    for (const reg of registrations) {
      if (reg.feePlanSnapshot && reg.feePlanSnapshot.length > 0 && reg.feePlanSnapshot[0].paymented === false) {
        await Registration.findByIdAndDelete(reg._id);
        // Xóa luôn các Payment (giao dịch) liên quan nếu có
        await Payment.deleteMany({ registrationId: reg._id });
      }
    }

    // 3. Xóa khóa học
    const course = await Course.findByIdAndDelete(id);

    if (!course) {
      return res
        .status(404)
        .json({ status: "error", message: "Course not found" });
    }

    res.json({
      status: "success",
      message: "Xoá khoá học thành công và đã dọn dẹp các hồ sơ liên quan chưa thanh toán",
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};
