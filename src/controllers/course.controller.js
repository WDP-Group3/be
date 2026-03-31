import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Registration from '../models/Registration.js';
import Payment from '../models/Payment.js';
import { buildFeePlanSnapshot } from '../utils/feeHelper.js';
import { autoEnrolllearners } from '../services/enrollment.service.js';

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
      query.status = status;
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

    // Cập nhật khoá học (Bỏ feeEffectiveDate logic)
    const course = await Course.findByIdAndUpdate(id, updates, { new: true });

    // Khi giá hoặc các đợt đóng phí thay đổi, cập nhật ngay lập tức cho các registration chưa đóng đợt 1
    if (updates.feePayments && (oldCourse.estimatedCost !== course.estimatedCost)) {
      const registrations = await Registration.find({ courseId: id });

      for (const reg of registrations) {
        // Kiểm tra xem đợt 1 đã đóng chưa
        if (reg.feePlanSnapshot && reg.feePlanSnapshot.length > 0 && reg.feePlanSnapshot[0].paymented === false) {
          // Cập nhật lại feePlanSnapshot theo giá mới/đợt mới
          reg.feePlanSnapshot = buildFeePlanSnapshot(course, reg.paymentPlanType);
          await reg.save();

          // Cập nhật Payment liên quan
          await Payment.updateMany(
            { registrationId: reg._id },
            { amount: course.estimatedCost }
          );
        }
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
