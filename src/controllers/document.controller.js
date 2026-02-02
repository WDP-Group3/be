import Document from '../models/Document.js';
import Registration from '../models/Registration.js';

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

