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
      status: 'success',
      pagination: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        itemsPerPage: limit
      },
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
      status: 'success',
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
      estimatedCost, // <-- Đã sửa ở đây
      description,
      image,
      status,
      estimatedDuration,
      location,
      note
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
      estimatedCost: estimatedCost || 0, // <-- Lưu thẳng vào model
      description,
      image,
      estimatedDuration,
      location: location || [],
      note,
      status
    });

    await newCourse.save();

    res.status(201).json({
      status: 'success',
      message: 'Tạo khoá học thành công',
      data: newCourse,
    });

  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ status: 'error', message: messages });
    }
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Dữ liệu bị trùng lặp (Mã khoá học)' });
    }
    res.status(500).json({ status: 'error', message: error.message });
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

    // 3. Lấy đúng field estimatedCost từ request
    const updates = req.body;

    // Kiểm tra trùng code nếu user có ý định sửa code
    if (updates.code) {
      const duplicateCheck = await Course.findOne({ code: updates.code, _id: { $ne: id } });
      if (duplicateCheck) {
        return res.status(409).json({
          status: 'error',
          message: `Mã khoá học "${updates.code}" đã được sử dụng.`
        });
      }
    }

    // Xử lý status đặc biệt (vì Frontend cũ có thể gửi mảng)
    if (updates.status && Array.isArray(updates.status)) {
      updates.status = updates.status[0];
    }

    // Nếu Client gửi field tên là "price", ta cần đổi nó thành "estimatedCost"
    // (Đoạn này để phòng hờ React vẫn gửi "price", nếu React đã sửa thì bỏ qua)
    if (updates.price !== undefined) {
      updates.estimatedCost = updates.price;
      delete updates.price;
    }

    const course = await Course.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    if (!course) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy khoá học để cập nhật' });
    }

    res.json({
      status: 'success',
      message: 'Cập nhật khoá học thành công',
      data: course,
    });

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * @desc    Xoá course
 * @route   DELETE /api/courses/:id
 * @access  Private (Admin)
 */
export const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findByIdAndDelete(id);

    if (!course) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy khoá học để xoá' });
    }

    res.json({
      status: 'success',
      message: 'Đã xoá khoá học vĩnh viễn',
      deletedId: id
    });

  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};