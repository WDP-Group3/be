import Registration from '../models/Registration.js';
import Document from '../models/Document.js';
import Batch from '../models/Batch.js';

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

// Tạo registration mới (Enroll)
export const createRegistration = async (req, res) => {
  try {
    const { batchId, registerMethod = 'ONLINE' } = req.body;
    const studentId = req.userId; // Lấy từ token authentication

    if (!batchId) {
      return res.status(400).json({
        status: 'error',
        message: 'Batch ID là bắt buộc',
      });
    }

    // Kiểm tra batch có tồn tại và đang mở không
    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({
        status: 'error',
        message: 'Không tìm thấy lớp học',
      });
    }

    if (batch.status !== 'OPEN') {
      return res.status(400).json({
        status: 'error',
        message: 'Lớp học đã đóng đăng ký',
      });
    }

    // Kiểm tra học viên đã đăng ký lớp này chưa
    const existingRegistration = await Registration.findOne({
      studentId,
      batchId,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] },
    });

    if (existingRegistration) {
      return res.status(400).json({
        status: 'error',
        message: 'Bạn đã đăng ký lớp học này rồi',
      });
    }

    // Tạo registration mới
    const registration = new Registration({
      studentId,
      batchId,
      registerMethod,
      status: 'NEW',
    });

    await registration.save();

    // Tạo document record mặc định
    const document = new Document({
      registrationId: registration._id,
      status: 'PENDING',
    });
    await document.save();

    // Populate để trả về thông tin đầy đủ
    const result = await Registration.findById(registration._id)
      .populate('studentId', 'fullName phone email')
      .populate('batchId', 'startDate estimatedEndDate location');

    res.status(201).json({
      status: 'success',
      data: result,
      message: 'Đăng ký thành công',
    });
  } catch (error) {
    console.error('Create registration error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

