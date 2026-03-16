import Document from '../models/Document.js';
import Registration from '../models/Registration.js';
import User from '../models/User.js';

const documentPopulate = [
  { path: 'LEARNERId', select: 'fullName phone email role status' },
  { path: 'consultantId', select: 'fullName phone email role avatar' },
  {
    path: 'registrationId',
    select: 'LEARNERId batchId status registerMethod createdAt',
    populate: [
      { path: 'LEARNERId', select: 'fullName phone email role status' },
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
  && document?.photo
);

export const getDocumentsForReview = async (req, res) => {
  try {
    const { status = 'PENDING', registerMethod } = req.query;

    const filter = { isDeleted: { $ne: true } };
    if (req.user?.role === 'ADMIN') {
      filter.status = 'PENDING';
    } else if (status) {
      filter.status = status;
    }

    if (req.user?.role === 'CONSULTANT') {
      const email = req.user?.email?.trim();
      const escapedEmail = email ? email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
      filter.$or = [
        { consultantId: req.userId },
        ...(email ? [{ consultantEmail: new RegExp(escapedEmail, 'i') }] : []),
      ];
    }

    const documents = await Document.find(filter)
      .populate(documentPopulate)
      .sort({ _id: -1 });

    const filtered = documents.filter((doc) => {
      const method = doc?.registrationId?.registerMethod;

      if (req.user?.role === 'CONSULTANT') return true;
      if (req.user?.role === 'ADMIN' && registerMethod) return method === registerMethod;
      return true;
    });

    // Helpful diagnostics for local troubleshooting
    // (Only included in development responses)
    let debug = undefined;
    if (process.env.NODE_ENV !== 'production') {
      const role = req.user?.role;
      const email = req.user?.email;
      const userId = req.userId;

      let consultantIdMatches = undefined;
      let consultantEmailMatches = undefined;
      if (role === 'CONSULTANT') {
        consultantIdMatches = await Document.countDocuments({ consultantId: userId, isDeleted: { $ne: true } });
        consultantEmailMatches = email
          ? await Document.countDocuments({ consultantEmail: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), isDeleted: { $ne: true } })
          : 0;
      }

      debug = {
        role,
        userId,
        email,
        appliedFilter: filter,
        consultantIdMatches,
        consultantEmailMatches,
      };
    }

    res.json({ status: 'success', data: filtered, count: filtered.length, ...(debug ? { debug } : {}) });
  } catch (error) {
    console.error('Get documents for review error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const lookupConsultantByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'email là bắt buộc' });
    }

    const consultant = await User.findOne({ role: 'CONSULTANT', email: email.trim().toLowerCase() })
      .select('fullName phone email role avatar');

    if (!consultant) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy tư vấn viên' });
    }

    return res.json({ status: 'success', data: consultant });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
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
      select: 'registerMethod LEARNERId batchId',
    });

    if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });

    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ status: 'error', message: 'Admin chỉ được xem hồ sơ, không có quyền duyệt' });
    }

    if (req.user?.role === 'CONSULTANT') {
      const consultantIdMatch = document?.consultantId?.toString() === req.userId;
      const consultantEmailMatch = document?.consultantEmail && req.user?.email
        && document.consultantEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!consultantIdMatch && !consultantEmailMatch) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền duyệt hồ sơ này' });
      }
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
    const { registrationId, status, LEARNERId } = req.query;
    const filter = { isDeleted: { $ne: true } };

    if (registrationId) filter.registrationId = registrationId;
    if (LEARNERId) filter.LEARNERId = LEARNERId;
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
    const LEARNERId = req.userId;

    let document = await Document.findOne({ LEARNERId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ LEARNERId, status: 'PENDING' });
      document = await Document.findById(document._id).populate(documentPopulate);
    }

    return res.json({ status: 'success', data: document, isComplete: isDocumentComplete(document) });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const uploadDocuments = async (req, res) => {
  try {
    const { registrationId, cccdImage, healthCertificate, photo, cccdNumber, consultantEmail } = req.body;
    const LEARNERId = req.userId;

    let registration = null;
    if (registrationId) {
      registration = await Registration.findById(registrationId);
      if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });
      if (registration.LEARNERId.toString() !== LEARNERId) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền upload hồ sơ này' });
      }
    }

    let document = await Document.findOne({ LEARNERId, isDeleted: { $ne: true } });
    if (!document) document = new Document({ LEARNERId, status: 'PENDING' });

    if (registration?._id) document.registrationId = registration._id;
    if (cccdImage) document.cccdImage = cccdImage;
    if (healthCertificate) document.healthCertificate = healthCertificate;
    if (photo) document.photo = photo;
    if (cccdNumber) document.cccdNumber = cccdNumber;

    if (consultantEmail) {
      const consultant = await User.findOne({ role: 'CONSULTANT', email: consultantEmail.trim().toLowerCase() });
      if (!consultant) {
        return res.status(400).json({ status: 'error', message: 'Không tìm thấy tư vấn viên theo email đã nhập' });
      }
      document.consultantId = consultant._id;
      document.consultantEmail = consultant.email;
    }

    if (cccdImage || healthCertificate || photo || cccdNumber || consultantEmail) document.status = 'PENDING';

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
    const LEARNERId = req.userId;

    const registration = await Registration.findById(registrationId);
    if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });

    if (registration.LEARNERId.toString() !== LEARNERId && req.user?.role !== 'ADMIN' && req.user?.role !== 'CONSULTANT') {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem hồ sơ này' });
    }

    let document = await Document.findOne({ LEARNERId: registration.LEARNERId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ LEARNERId: registration.LEARNERId, registrationId, status: 'PENDING' });
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

    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ status: 'error', message: 'Admin không có quyền xóa ảo hồ sơ' });
    }

    const document = await Document.findById(id).select('consultantId consultantEmail');
    if (!document) {
      return res.status(404).json({ status: 'error', message: 'Document not found' });
    }

    if (req.user?.role === 'CONSULTANT') {
      const consultantIdMatch = document?.consultantId?.toString() === req.userId;
      const consultantEmailMatch = document?.consultantEmail && req.user?.email
        && document.consultantEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!consultantIdMatch && !consultantEmailMatch) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xóa hồ sơ này' });
      }
    }

    await Document.findByIdAndUpdate(
      id,
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      },
      { new: true, runValidators: false }
    );

    return res.json({ status: 'success', message: 'Đã xóa ảo hồ sơ' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
