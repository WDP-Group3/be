import Document from '../models/Document.js';
import Registration from '../models/Registration.js';

const documentPopulate = [
  { path: 'studentId', select: 'fullName phone email role status' },
  {
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
  },
];

const isDocumentComplete = (document) => !!(
  document?.cccdNumber
  && document?.cccdImage
  && document?.healthCertificate
  && document?.photo
);

export const getDocumentsForReview = async (req, res) => {
  try {
    const { status = 'PENDING', registerMethod } = req.query;

    const filter = { isDeleted: { $ne: true } };
    if (status) filter.status = status;

    const documents = await Document.find(filter)
      .populate(documentPopulate)
      .sort({ _id: -1 });

    const filtered = documents.filter((doc) => {
      const method = doc?.registrationId?.registerMethod;

      if (req.user?.role === 'CONSULTANT') return method === 'CONSULTANT';
      if (req.user?.role === 'ADMIN' && registerMethod) return method === registerMethod;
      return true;
    });

    res.json({ status: 'success', data: filtered, count: filtered.length });
  } catch (error) {
    console.error('Get documents for review error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateDocumentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowed = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Trạng thái không hợp lệ' });
    }

    const document = await Document.findById(id).populate({
      path: 'registrationId',
      select: 'registerMethod studentId batchId',
    });

    if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });

    if (req.user?.role === 'CONSULTANT' && document.registrationId?.registerMethod !== 'CONSULTANT') {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền duyệt hồ sơ này' });
    }

    document.status = status;
    await document.save();

    const result = await Document.findById(document._id).populate(documentPopulate);
    return res.json({ status: 'success', data: result, message: 'Cập nhật trạng thái hồ sơ thành công' });
  } catch (error) {
    console.error('Update document status error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getAllDocuments = async (req, res) => {
  try {
    const { registrationId, status, studentId } = req.query;
    const filter = { isDeleted: { $ne: true } };

    if (registrationId) filter.registrationId = registrationId;
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;

    const documents = await Document.find(filter).populate(documentPopulate).sort({ _id: -1 });
    return res.json({ status: 'success', data: documents, count: documents.length });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await Document.findOne({ _id: id, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });
    return res.json({ status: 'success', data: document });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getMyDocument = async (req, res) => {
  try {
    const studentId = req.userId;

    let document = await Document.findOne({ studentId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ studentId, status: 'PENDING' });
      document = await Document.findById(document._id).populate(documentPopulate);
    }

    return res.json({ status: 'success', data: document, isComplete: isDocumentComplete(document) });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const uploadDocuments = async (req, res) => {
  try {
    const { registrationId, cccdImage, healthCertificate, photo, cccdNumber } = req.body;
    const studentId = req.userId;

    let registration = null;
    if (registrationId) {
      registration = await Registration.findById(registrationId);
      if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });
      if (registration.studentId.toString() !== studentId) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền upload hồ sơ này' });
      }
    }

    let document = await Document.findOne({ studentId, isDeleted: { $ne: true } });
    if (!document) document = new Document({ studentId, status: 'PENDING' });

    if (registration?._id) document.registrationId = registration._id;
    if (cccdImage) document.cccdImage = cccdImage;
    if (healthCertificate) document.healthCertificate = healthCertificate;
    if (photo) document.photo = photo;
    if (cccdNumber) document.cccdNumber = cccdNumber;

    if (cccdImage || healthCertificate || photo || cccdNumber) document.status = 'PENDING';

    await document.save();

    const result = await Document.findById(document._id).populate(documentPopulate);
    return res.json({
      status: 'success',
      data: result,
      isComplete: isDocumentComplete(result),
      message: 'Upload hồ sơ thành công',
    });
  } catch (error) {
    console.error('Upload documents error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getDocumentsByRegistration = async (req, res) => {
  try {
    const { registrationId } = req.params;
    const studentId = req.userId;

    const registration = await Registration.findById(registrationId);
    if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });

    if (registration.studentId.toString() !== studentId && req.user?.role !== 'ADMIN' && req.user?.role !== 'CONSULTANT') {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem hồ sơ này' });
    }

    let document = await Document.findOne({ studentId: registration.studentId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ studentId: registration.studentId, registrationId, status: 'PENDING' });
      document = await Document.findById(document._id).populate(documentPopulate);
    }

    if (!document.registrationId) {
      document.registrationId = registrationId;
      await document.save();
      document = await Document.findById(document._id).populate(documentPopulate);
    }

    return res.json({ status: 'success', data: document, isComplete: isDocumentComplete(document) });
  } catch (error) {
    console.error('Get documents by registration error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const softDeleteDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await Document.findByIdAndUpdate(
      id,
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      },
      { new: true, runValidators: false }
    );

    if (!updated) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    return res.json({ status: 'success', message: 'Đã xóa ảo hồ sơ' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
