import Course from '../models/Course.js';

// Lấy tất cả courses
export const getAllCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ code: 1 });
    res.json({
      status: 'success',
      data: courses,
      count: courses.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy course theo ID
export const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Course.findById(id);

    if (!course) {
      return res.status(404).json({
        status: 'error',
        message: 'Course not found',
      });
    }

    res.json({
      status: 'success',
      data: course,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};


// Tạo course mới
export const createCourse = async (req, res) => {
  try {
    const { code, name, price, description, image } = req.body;

    if (!code || !name) {
      return res.status(400).json({ status: 'error', message: 'Mã và Tên khoá học là bắt buộc' });
    }

    const newCourse = new Course({
      code,
      name,
      price,
      description,
      image,
      status: 'Active'
    });

    await newCourse.save();

    res.status(201).json({
      status: 'success',
      data: newCourse,
      message: 'Tạo khoá học thành công'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Cập nhật course
export const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const course = await Course.findByIdAndUpdate(id, updates, { new: true });

    if (!course) {
      return res.status(404).json({ status: 'error', message: 'Course not found' });
    }

    res.json({
      status: 'success',
      data: course,
      message: 'Cập nhật khoá học thành công'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Xoá course
export const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;

    // Check business rule: Cannot delete if has active learners (Mock check)
    // const hasLearners = await checkLearners(id);
    // if (hasLearners) return res.status(403).json({...})

    const course = await Course.findByIdAndDelete(id);

    if (!course) {
      return res.status(404).json({ status: 'error', message: 'Course not found' });
    }

    res.json({
      status: 'success',
      message: 'Xoá khoá học thành công'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
