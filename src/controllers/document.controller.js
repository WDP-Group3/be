import fs from 'fs';
import Document from '../models/Document.js';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import { uploadFile } from '../services/cloudinary.service.js';

const documentPopulate = [
  { path: 'learnerId', select: 'fullName phone email role status' },
  { path: 'consultantId', select: 'fullName phone email role avatar' },
  {
    path: 'registrationId',
    select: 'learnerId batchId status registerMethod createdAt',
    populate: [
      { path: 'learnerId', select: 'fullName phone email role status' },
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
  && document?.cccdImageFront
  && document?.cccdImageBack
  && document?.photo
);

export const getDocumentsForReview = async (req, res) => {
  try {
    const { status = 'PENDING', registerMethod } = req.query;

    const filter = { isDeleted: { $ne: true } };
    if (status) {
      filter.status = status;
    }

    if (req.user?.role === 'CONSULTANT' || req.user?.role === 'INSTRUCTOR') {
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

      if (req.user?.role === 'CONSULTANT' || req.user?.role === 'INSTRUCTOR') return true;
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
      if (role === 'CONSULTANT' || role === 'INSTRUCTOR') {
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

    const consultant = await User.findOne({ 
      role: { $in: ['CONSULTANT', 'INSTRUCTOR'] }, 
      email: email.trim().toLowerCase() 
    })
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
    const { status, rejectionReason } = req.body;

    const allowed = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Trạng thái không hợp lệ' });
    }

    if (status === 'REJECTED' && !rejectionReason?.trim()) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng nhập lý do từ chối' });
    }

    const document = await Document.findById(id).populate({
      path: 'registrationId',
      select: 'registerMethod learnerId batchId',
    });

    if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });

    if (req.user?.role === 'ADMIN') {
      return res.status(403).json({ status: 'error', message: 'Admin chỉ được xem hồ sơ, không có quyền duyệt' });
    }

    if (req.user?.role === 'CONSULTANT' || req.user?.role === 'INSTRUCTOR') {
      const consultantIdMatch = document?.consultantId?.toString() === req.userId;
      const consultantEmailMatch = document?.consultantEmail && req.user?.email
        && document.consultantEmail.toLowerCase() === req.user.email.toLowerCase();
      if (!consultantIdMatch && !consultantEmailMatch) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền duyệt hồ sơ này' });
      }
    }

    document.status = status;
    if (status === 'REJECTED') {
      document.rejectionReason = rejectionReason.trim();
    } else {
      document.rejectionReason = null;
    }
    await document.save();

    if (status === 'APPROVED') {
      const user = await User.findById(document.learnerId);
      if (user) {
        if (document.cccdNumber) user.cccdNumber = document.cccdNumber;
        if (document.cccdImageFront) user.cccdImageFront = document.cccdImageFront;
        if (document.cccdImageBack) user.cccdImageBack = document.cccdImageBack;
        if (document.healthCertificate) user.healthCertificate = document.healthCertificate;
        if (document.photo) user.photo = document.photo;
        await user.save();
      }
    }

    // Auto-notify learner on rejection
    if (status === 'REJECTED') {
      (async () => {
        try {
          const Notification = (await import('../models/Notification.js')).default;
          await Notification.create({
            userId: document.learnerId,
            type: 'OTHER',
            title: 'Hồ sơ bị từ chối',
            message: `Hồ sơ của bạn đã bị từ chối. Lý do: ${rejectionReason.trim()}. Vui lòng đăng nhập để xem chi tiết và bổ sung.`,
            expirationDays: 7,
          });
        } catch (notifErr) {
          console.error('Failed to create rejection notification:', notifErr);
        }
      })();
    }

    const result = await Document.findById(document._id).populate(documentPopulate);
    return res.json({ status: 'success', data: result, message: 'Cập nhật trạng thái hồ sơ thành công' });
  } catch (error) {
    console.error('Update document status error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getAllDocuments = async (req, res) => {
  try {
    const { registrationId, status, learnerId } = req.query;
    const filter = { isDeleted: { $ne: true } };

    if (registrationId) filter.registrationId = registrationId;
    if (learnerId) filter.learnerId = learnerId;
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
    const learnerId = req.userId;

    let document = await Document.findOne({ learnerId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ learnerId, status: 'DRAFT' });
      document = await Document.findById(document._id).populate(documentPopulate);
    }

    return res.json({ status: 'success', data: document, isComplete: isDocumentComplete(document) });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const uploadDocuments = async (req, res) => {
  try {
    const { registrationId, cccdImageFront, cccdImageBack, healthCertificate, photo, cccdNumber, consultantEmail } = req.body;
    const learnerId = req.userId;

    // Validate CCCD format: 9 or 12 digits
    if (cccdNumber) {
      const cccdClean = cccdNumber.replace(/\s/g, '');
      if (!/^[0-9]{9}$|^[0-9]{12}$/.test(cccdClean)) {
        return res.status(400).json({ status: 'error', message: 'Số CMND/CCCD phải là 9 hoặc 12 chữ số' });
      }
      // Check uniqueness (exclude current user's document)
      const existing = await Document.findOne({ cccdNumber: cccdClean, learnerId: { $ne: learnerId }, isDeleted: { $ne: true } });
      if (existing) {
        return res.status(400).json({ status: 'error', message: 'Số CMND/CCCD đã được sử dụng bởi người khác' });
      }
    }

    let registration = null;
    if (registrationId) {
      registration = await Registration.findById(registrationId);
      if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });
      if (registration.learnerId.toString() !== learnerId) {
        return res.status(403).json({ status: 'error', message: 'Bạn không có quyền upload hồ sơ này' });
      }
    }

    let document = await Document.findOne({ learnerId, isDeleted: { $ne: true } });
    if (!document) document = new Document({ learnerId, status: 'DRAFT' });

    if (registration?._id) document.registrationId = registration._id;
    if (cccdImageFront) document.cccdImageFront = cccdImageFront;
    if (cccdImageBack) document.cccdImageBack = cccdImageBack;
    if (healthCertificate) document.healthCertificate = healthCertificate;
    if (photo) document.photo = photo;
    if (cccdNumber) document.cccdNumber = cccdNumber;

    if (consultantEmail) {
      const consultant = await User.findOne({
        role: { $in: ['CONSULTANT', 'INSTRUCTOR'] },
        email: consultantEmail.trim().toLowerCase()
      });
      if (!consultant) {
        return res.status(400).json({ status: 'error', message: 'Không tìm thấy tư vấn viên theo email đã nhập' });
      }
      document.consultantId = consultant._id;
      document.consultantEmail = consultant.email;
    }

    if (cccdImageFront || cccdImageBack || healthCertificate || photo || cccdNumber || consultantEmail) document.status = 'PENDING';

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

// Upload documents via multipart/form-data — BE uploads files to Cloudinary
export const uploadDocumentsMultipart = async (req, res) => {
  try {
    const { cccdNumber, consultantEmail } = req.body;
    const learnerId = req.userId;

    // Validate CCCD format
    if (cccdNumber) {
      const cccdClean = cccdNumber.replace(/\s/g, '');
      if (!/^[0-9]{9}$|^[0-9]{12}$/.test(cccdClean)) {
        return res.status(400).json({ status: 'error', message: 'Số CMND/CCCD phải là 9 hoặc 12 chữ số' });
      }
      const existing = await Document.findOne({ cccdNumber: cccdClean, learnerId: { $ne: learnerId }, isDeleted: { $ne: true } });
      if (existing) {
        return res.status(400).json({ status: 'error', message: 'Số CMND/CCCD đã được sử dụng bởi người khác' });
      }
    }

    // Helper: upload a single file field to Cloudinary, then clean up temp file
    const uploadField = async (files, fieldName) => {
      const file = files?.[fieldName]?.[0];
      if (!file) return null;

      try {
        const filePath = file.path;
        const result = await uploadFile(filePath, { folder: 'documents' });
        return result.secure_url;
      } catch (err) {
        throw new Error(`Upload ${fieldName} thất bại: ${err.message}`);
      } finally {
        // Always clean up temp file
        try { fs.unlinkSync(file.path); } catch { /* ignore */ }
      }
    };

    // Upload all files to Cloudinary server-side
    const uploaded = {
      cccdImageFront: await uploadField(req.files, 'cccdImageFront'),
      cccdImageBack: await uploadField(req.files, 'cccdImageBack'),
      healthCertificate: await uploadField(req.files, 'healthCertificate'),
      photo: await uploadField(req.files, 'photo'),
    };

    // Resolve consultant
    let consultantId = null;
    let consultantEmailResolved = null;
    if (consultantEmail) {
      const consultant = await User.findOne({
        role: { $in: ['CONSULTANT', 'INSTRUCTOR'] },
        email: consultantEmail.trim().toLowerCase()
      });
      if (!consultant) {
        return res.status(400).json({ status: 'error', message: 'Không tìm thấy tư vấn viên theo email đã nhập' });
      }
      consultantId = consultant._id;
      consultantEmailResolved = consultant.email;
    }

    // Upsert document
    let document = await Document.findOne({ learnerId, isDeleted: { $ne: true } });
    if (!document) document = new Document({ learnerId, status: 'DRAFT' });

    // Only update fields that were uploaded (don't overwrite with null)
    if (uploaded.cccdImageFront) document.cccdImageFront = uploaded.cccdImageFront;
    if (uploaded.cccdImageBack) document.cccdImageBack = uploaded.cccdImageBack;
    if (uploaded.healthCertificate) document.healthCertificate = uploaded.healthCertificate;
    if (uploaded.photo) document.photo = uploaded.photo;
    if (cccdNumber) document.cccdNumber = cccdNumber;
    if (consultantId) {
      document.consultantId = consultantId;
      document.consultantEmail = consultantEmailResolved;
    }

    // Clear rejection reason on resubmit
    if (document.status === 'REJECTED') {
      document.rejectionReason = null;
    }

    // Set to PENDING if any field was submitted
    if (uploaded.cccdImageFront || uploaded.cccdImageBack || uploaded.photo || cccdNumber || consultantEmail) {
      document.status = 'PENDING';
    }

    await document.save();

    const result = await Document.findById(document._id).populate(documentPopulate);
    return res.json({
      status: 'success',
      data: result,
      isComplete: isDocumentComplete(result),
      message: 'Upload hồ sơ thành công',
    });
  } catch (error) {
    console.error('Upload documents multipart error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getDocumentsByRegistration = async (req, res) => {
  try {
    const { registrationId } = req.params;
    const learnerId = req.userId;

    const registration = await Registration.findById(registrationId);
    if (!registration) return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ đăng ký' });

    if (registration.learnerId.toString() !== learnerId && req.user?.role !== 'ADMIN' && req.user?.role !== 'CONSULTANT' && req.user?.role !== 'INSTRUCTOR') {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem hồ sơ này' });
    }

    let document = await Document.findOne({ learnerId: registration.learnerId, isDeleted: { $ne: true } }).populate(documentPopulate);
    if (!document) {
      document = await Document.create({ learnerId: registration.learnerId, registrationId, status: 'DRAFT' });
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

    if (req.user?.role === 'CONSULTANT' || req.user?.role === 'INSTRUCTOR') {
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
