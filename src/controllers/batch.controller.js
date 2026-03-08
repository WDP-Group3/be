import Batch from '../models/Batch.js';

// Lấy tất cả batches
export const getAllBatches = async (req, res) => {
  try {
    const { courseId, status } = req.query;
    const filter = {};

    if (courseId) filter.courseId = courseId;
    if (status) filter.status = status;

    const batches = await Batch.find(filter)
      .populate('courseId', 'code name')
      .populate('instructorIds', 'fullName phone')
      .sort({ startDate: -1 });

    res.json({
      status: 'success',
      data: batches,
      count: batches.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy batch theo ID
export const getBatchById = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findById(id)
      .populate('courseId')
      .populate('instructorIds', 'fullName phone email');

    if (!batch) {
      return res.status(404).json({
        status: 'error',
        message: 'Batch not found',
      });
    }

    res.json({
      status: 'success',
      data: batch,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Tạo batch mới (Admin)
export const createBatch = async (req, res) => {
  try {
    const { courseId, startDate, estimatedEndDate, location, instructorIds = [], status = 'OPEN' } = req.body;

    if (!courseId || !startDate || !estimatedEndDate || !location) {
      return res.status(400).json({
        status: 'error',
        message: 'courseId, startDate, estimatedEndDate, location là bắt buộc',
      });
    }

    const batch = await Batch.create({
      courseId,
      startDate,
      estimatedEndDate,
      location,
      instructorIds,
      status,
    });

    const result = await Batch.findById(batch._id).populate('courseId', 'code name');

    return res.status(201).json({
      status: 'success',
      message: 'Tạo lớp học thành công',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Cập nhật batch (Admin)
export const updateBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const batch = await Batch.findByIdAndUpdate(id, updates, { new: true })
      .populate('courseId', 'code name')
      .populate('instructorIds', 'fullName phone email');

    if (!batch) {
      return res.status(404).json({
        status: 'error',
        message: 'Batch not found',
      });
    }

    return res.json({
      status: 'success',
      message: 'Cập nhật lớp học thành công',
      data: batch,
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Xóa batch (Admin)
export const deleteBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findByIdAndDelete(id);

    if (!batch) {
      return res.status(404).json({
        status: 'error',
        message: 'Batch not found',
      });
    }

    return res.json({
      status: 'success',
      message: 'Xóa lớp học thành công',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};