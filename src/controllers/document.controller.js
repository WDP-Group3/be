import Document from '../models/Document.js';
import Registration from '../models/Registration.js';

// --- [REVIEW] Danh sách hồ sơ cần duyệt (Sale/Admin) ---
export const getDocumentsForReview = async (req, res) => {
  try {
    const { status = 'PENDING', registerMethod } = req.query;

    const filter = {};
    if (status) filter.status = status;

    // Consultant (Sale) chỉ xem hồ sơ theo registerMethod CONSULTANT
    let allowedRegistrationIds = null;
    if (req.user?.role === 'CONSULTANT') {
      const regs = await Registration.find({ registerMethod: 'CONSULTANT' }).select('_id');
      allowedRegistrationIds = regs.map((r) => r._id);
    } else if (req.user?.role === 'ADMIN' && registerMethod) {
      const regs = await Registration.find({ registerMethod }).select('_id');
      allowedRegistrationIds = regs.map((r) => r._id);
    }

    if (Array.isArray(allowedRegistrationIds)) {
      filter.registrationId = { $in: allowedRegistrationIds };
    }

    const documents = await Document.find(filter)
      .populate({
        path: 'registrationId',
        select: 'studentId batchId status registerMethod createdAt',
        populate: [
          { path: 'studentId', select: 'fullName phone email role status' },
          {
            path: 'batchId',
            select: 'location startDate status courseId',
            populate: [{ path: 'courseId', select: 'code name' }],
          },
        ],
      })
      .sort({ _id: -1 });

    res.json({
      status: 'success',
      data: documents,
      count: documents.length,
    });
  } catch (error) {
    console.error('Get documents for review error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// --- [REVIEW] Cập nhật trạng thái hồ sơ (Approve/Reject) ---
export const updateDocumentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        status: 'error',
        message: 'Trạng thái không hợp lệ',
      });
    }

    const document = await Document.findById(id).populate({
      path: 'registrationId',
      select: 'registerMethod studentId batchId',
    });

    if (!document) {
      return res.status(404).json({
        status: 'error',
        message: 'Document not found',
      });
    }

    // Consultant chỉ được duyệt hồ sơ thuộc luồng CONSULTANT
    if (req.user?.role === 'CONSULTANT' && document.registrationId?.registerMethod !== 'CONSULTANT') {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn không có quyền duyệt hồ sơ này',
      });
    }

    document.status = status;
    await document.save();

    const result = await Document.findById(document._id).populate({
      path: 'registrationId',
      select: 'studentId batchId status registerMethod',
      populate: [
        { path: 'studentId', select: 'fullName phone email' },
        { path: 'batchId', select: 'location startDate courseId', populate: [{ path: 'courseId', select: 'code name' }] },
      ],
    });

    res.json({
      status: 'success',
      data: result,
      message: 'Cập nhật trạng thái hồ sơ thành công',
    });
  } catch (error) {
    console.error('Update document status error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy tất cả documents
export const getAllDocuments = async (req, res) => {
  try {
    const { registrationId, status } = req.query;
    const filter = {};
    
    if (registrationId) filter.registrationId = registrationId;
    if (status) filter.status = status;
    
    const documents = await Document.find(filter)
      .populate('registrationId', 'studentId batchId')
      .sort({ _id: -1 });
    
    res.json({
      status: 'success',
      data: documents,
      count: documents.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy document theo ID
export const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findById(id)
      .populate('registrationId');
    
    if (!document) {
      return res.status(404).json({
        status: 'error',
        message: 'Document not found',
      });
    }
    
    res.json({
      status: 'success',
      data: document,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Upload documents (UC09: Enroll & Upload Docs)
export const uploadDocuments = async (req, res) => {
  try {
    const { registrationId, cccdImage, healthCertificate, photo, cccdNumber } = req.body;
    const studentId = req.userId; // Lấy từ token authentication

    if (!registrationId) {
      return res.status(400).json({
        status: 'error',
        message: 'Registration ID là bắt buộc',
      });
    }

    // Kiểm tra registration có tồn tại và thuộc về student này không
    const registration = await Registration.findById(registrationId);
    if (!registration) {
      return res.status(404).json({
        status: 'error',
        message: 'Không tìm thấy hồ sơ đăng ký',
      });
    }

    // Kiểm tra quyền: chỉ học viên sở hữu hồ sơ mới được upload
    if (registration.studentId.toString() !== studentId) {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn không có quyền upload hồ sơ này',
      });
    }

    // Tìm hoặc tạo document
    let document = await Document.findOne({ registrationId });
    
    if (!document) {
      document = new Document({
        registrationId,
        status: 'PENDING',
      });
    }

    // Cập nhật thông tin documents
    if (cccdImage) document.cccdImage = cccdImage;
    if (healthCertificate) document.healthCertificate = healthCertificate;
    if (photo) document.photo = photo;
    if (cccdNumber) document.cccdNumber = cccdNumber;

    // Nếu đã có đủ 3 loại giấy tờ, tự động chuyển sang PENDING để staff duyệt
    if (document.cccdImage && document.healthCertificate && document.photo) {
      document.status = 'PENDING'; // Chờ staff duyệt
    }

    await document.save();

    // Populate để trả về thông tin đầy đủ
    const result = await Document.findById(document._id)
      .populate('registrationId', 'studentId batchId status');

    res.json({
      status: 'success',
      data: result,
      message: 'Upload hồ sơ thành công',
    });
  } catch (error) {
    console.error('Upload documents error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy documents theo registrationId (UC10: View Document Status)
export const getDocumentsByRegistration = async (req, res) => {
  try {
    const { registrationId } = req.params;
    const studentId = req.userId; // Lấy từ token authentication

    // Kiểm tra registration có tồn tại và thuộc về student này không
    const registration = await Registration.findById(registrationId);
    if (!registration) {
      return res.status(404).json({
        status: 'error',
        message: 'Không tìm thấy hồ sơ đăng ký',
      });
    }

    // Kiểm tra quyền: chỉ học viên sở hữu hoặc admin/staff mới được xem
    if (registration.studentId.toString() !== studentId && req.user?.role !== 'ADMIN' && req.user?.role !== 'CONSULTANT') {
      return res.status(403).json({
        status: 'error',
        message: 'Bạn không có quyền xem hồ sơ này',
      });
    }

    const document = await Document.findOne({ registrationId })
      .populate('registrationId', 'studentId batchId status');

    if (!document) {
      // Nếu chưa có document, tạo mới với status PENDING
      const newDocument = new Document({
        registrationId,
        status: 'PENDING',
      });
      await newDocument.save();
      
      const result = await Document.findById(newDocument._id)
        .populate('registrationId', 'studentId batchId status');
      
      return res.json({
        status: 'success',
        data: result,
      });
    }

    res.json({
      status: 'success',
      data: document,
    });
  } catch (error) {
    console.error('Get documents by registration error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

