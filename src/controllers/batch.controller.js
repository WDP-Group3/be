import Batch from '../models/Batch.js';
import Registration from '../models/Registration.js';
import { autoEnrolllearners } from '../services/enrollment.service.js';

// Lấy tất cả batches
export const getAllBatches = async (req, res) => {
  try {
    const { courseId, status } = req.query;
    const filter = {};

    if (courseId) filter.courseId = courseId;
    if (status) filter.status = status;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const batches = await Batch.find(filter)
      .populate('courseId', 'code name')
      .populate('instructorIds', 'fullName phone')
      .populate('examLocationId', 'name address')
      .sort({ startDate: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Batch.countDocuments(filter);

    const batchesWithCount = await Promise.all(batches.map(async (batch) => {
      const learnerCount = await Registration.countDocuments({
        batchId: batch._id,
        status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
      });
      return { ...batch.toObject(), learnerCount };
    }));

    res.json({
      status: 'success',
      data: batchesWithCount,
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
      .populate('instructorIds', 'fullName phone email')
      .populate('examLocationId', 'name address');

    if (!batch) {
      return res.status(404).json({
        status: 'error',
        message: 'Batch not found',
      });
    }

    const learnerCount = await Registration.countDocuments({
      batchId: batch._id,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] }
    });

    res.json({
      status: 'success',
      data: { ...batch.toObject(), learnerCount },
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
    const { courseId, name, examLocation, examLocationId, minlearners, startDate, estimatedEndDate, location, maxlearners, instructorIds = [], status = 'OPEN' } = req.body;

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
      examLocationId: examLocationId || null,
      minlearners: minlearners || 1,
      startDate,
      estimatedEndDate,
      location,
      maxlearners,
      instructorIds,
      status,
    });

    const result = await Batch.findById(batch._id).populate('courseId', 'code name');

    // Tự động gán học viên đã thanh toán vào lớp mới tạo
    const enrollResult = await autoEnrolllearners(courseId, { batchId: batch._id });
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
      .populate('instructorIds', 'fullName phone email')
      .populate('examLocationId', 'name address');

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

    // Hoàn tác: Reset tất cả học viên thuộc lớp này về trạng thái chờ
    await Registration.updateMany(
      { batchId: id },
      { $set: { batchId: null, status: 'WAITING' } }
    );

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

export const autoEnrollBatch = async (req, res) => {
  try {
    const { id } = req.params;
    const batch = await Batch.findById(id);
    if (!batch) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy lớp học' });
    }

    if (batch.status !== 'OPEN') {
      return res.status(400).json({ status: 'error', message: 'Lớp học không ở trạng thái MỞ' });
    }

    const enrollResult = await autoEnrolllearners(batch.courseId, { batchId: batch._id });
    
    return res.status(200).json({
      status: 'success',
      message: enrollResult.message,
      data: enrollResult
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
