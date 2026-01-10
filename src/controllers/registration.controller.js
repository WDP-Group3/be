import Registration from '../models/Registration.js';

// Lấy tất cả registrations
export const getAllRegistrations = async (req, res) => {
  try {
    const { studentId, batchId, status } = req.query;
    const filter = {};
    
    if (studentId) filter.studentId = studentId;
    if (batchId) filter.batchId = batchId;
    if (status) filter.status = status;
    
    const registrations = await Registration.find(filter)
      .populate('studentId', 'fullName phone email')
      .populate('batchId', 'startDate estimatedEndDate location')
      .sort({ createdAt: -1 });
    
    res.json({
      status: 'success',
      data: registrations,
      count: registrations.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy registration theo ID
export const getRegistrationById = async (req, res) => {
  try {
    const { id } = req.params;
    const registration = await Registration.findById(id)
      .populate('studentId')
      .populate('batchId');
    
    if (!registration) {
      return res.status(404).json({
        status: 'error',
        message: 'Registration not found',
      });
    }
    
    res.json({
      status: 'success',
      data: registration,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

