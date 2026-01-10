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

