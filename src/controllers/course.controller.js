import mongoose from 'mongoose';
import Course from '../models/Course.js';

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
      count: courses.length,
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

    // 2. Tạo object khớp hoàn toàn với Schema
    const newCourse = new Course({
      code,
      name,
      estimatedCost: estimatedCost,
      feePayments: feePayments || [],
      estimatedDuration,
      location: location || [],
      status: "Active",
      description,
      image,
      location: location || [],
      note,
    });

    await newCourse.save();

    res.status(201).json({
      status: 'success',
      message: 'Tạo khoá học thành công',
      data: newCourse,
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

    const updates = req.body;

    const course = await Course.findByIdAndUpdate(id, updates, { new: true });
    if (!course) {
      return res
        .status(404)
        .json({ status: "error", message: "Course not found" });
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
    const course = await Course.findByIdAndDelete(id);

    if (!course) {
      return res
        .status(404)
        .json({ status: "error", message: "Course not found" });
    }

    res.json({
      status: "success",
      message: "Xoá khoá học thành công",
    });

  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};