import Batch from '../models/Batch.js';
import Registration from '../models/Registration.js';
import { autoEnrollStudents } from '../services/enrollment.service.js';

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

    const batchesWithCount = await Promise.all(batches.map(async (batch) => {
      const studentCount = await Registration.countDocuments({
        batchId: batch._id,
        status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
      });
      return { ...batch.toObject(), studentCount };
    }));

    res.json({
      status: 'success',
      data: batchesWithCount,
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

    const studentCount = await Registration.countDocuments({
      batchId: batch._id,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
    });

    res.json({
      status: 'success',
      data: { ...batch.toObject(), studentCount },
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

export const createBatch = async (req, res) => {
  try {
    const { courseId, name, examLocation, startDate, estimatedEndDate, location, maxStudents, instructorIds = [], status = 'OPEN' } = req.body;

    if (!courseId || !startDate || !estimatedEndDate || !location) {
      return res.status(400).json({
        status: 'error',
        message: 'courseId, startDate, estimatedEndDate, location là bắt buộc',
      });
    }

    const batch = await Batch.create({
      courseId,
      name,
      examLocation,
      startDate,
      estimatedEndDate,
      location,
      maxStudents,
      instructorIds,
      status,
    });

    const result = await Batch.findById(batch._id).populate('courseId', 'code name');

    // Tự động gán học viên đã thanh toán vào lớp mới tạo
    const enrollResult = await autoEnrollStudents(courseId, { batchId: batch._id });
    console.log(`[CREATE-BATCH] Auto-enroll result:`, enrollResult.message);

    return res.status(201).json({
      status: 'success',
      message: 'Tạo lớp học thành công',
      data: result,
      enrollInfo: enrollResult.success ? {
        enrolledCount: enrollResult.enrolledCount,
        newlyEnrolled: enrollResult.newlyEnrolled?.length || 0
      } : null
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