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

