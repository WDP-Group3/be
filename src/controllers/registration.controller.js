import Registration from '../models/Registration.js';
import Document from '../models/Document.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import User from '../models/User.js';

const buildFeePlanSnapshot = (course, paymentPlanType = 'INSTALLMENT') => {
  const feePayments = Array.isArray(course?.feePayments) ? course.feePayments : [];
  const totalFromInstallments = feePayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const fallbackCost = Number(course?.estimatedCost) || 0;
  const totalFee = totalFromInstallments > 0 ? totalFromInstallments : fallbackCost;

  if (paymentPlanType === 'FULL') {
    return [
      {
        name: 'Đóng 1 lần',
        amount: totalFee,
        dueDate: null,
        note: 'Thanh toán toàn bộ học phí 1 lần',
      },
    ];
  }

  if (feePayments.length > 0) {
    return feePayments.map((item, idx) => ({
      name: item.name || `Đợt ${idx + 1}`,
      amount: Number(item.amount) || 0,
      dueDate: item.dueDate || null,
      note: item.note || '',
    }));
  }

  return [
    {
      name: 'Đợt 1',
      amount: totalFee,
      dueDate: null,
      note: 'Mặc định do khóa học chưa cấu hình đợt phí',
    },
  ];
};

const hasCompleteDocumentProfile = (doc) => !!(
  doc?.cccdNumber
  && doc?.cccdImage
  && doc?.healthCertificate
  && doc?.photo
);

export const getAllRegistrations = async (req, res) => {
  try {
    const { studentId, batchId, status } = req.query;
    const filter = {};

    if (req.user?.role === 'STUDENT') {
      filter.studentId = req.userId;
    } else if (studentId) {
      filter.studentId = studentId;
    }

    if (batchId) filter.batchId = batchId;
    if (status) filter.status = status;

    const registrations = await Registration.find(filter)
      .populate('studentId', 'fullName phone email')
      .populate({
        path: 'batchId',
        populate: { path: 'courseId', select: 'code name estimatedCost feePayments' },
      })
      .sort({ createdAt: -1 });

    res.json({ status: 'success', data: registrations, count: registrations.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getRegistrationById = async (req, res) => {
  try {
    const { id } = req.params;
    const registration = await Registration.findById(id)
      .populate('studentId')
      .populate({
        path: 'batchId',
        populate: { path: 'courseId', select: 'code name estimatedCost feePayments' },
      });

    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Registration not found' });
    }

    res.json({ status: 'success', data: registration });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createRegistration = async (req, res) => {
  try {
    const { 
      batchId, 
      courseId, // Thêm courseId để cho phép đăng ký không cần batch
      registerMethod = 'ONLINE', 
      paymentPlanType = 'INSTALLMENT' 
    } = req.body;
    const studentId = req.userId;

    // Cho phép đăng ký với courseId hoặc batchId
    if (!batchId && !courseId) {
      return res.status(400).json({ status: 'error', message: 'Batch ID hoặc Course ID là bắt buộc' });
    }

    let batch = null;
    let actualCourseId = courseId;

    // Nếu có batchId, lấy thông tin batch và course
    if (batchId) {
      batch = await Batch.findById(batchId).populate('courseId');
      if (!batch) {
        return res.status(404).json({ status: 'error', message: 'Không tìm thấy lớp học' });
      }

      if (batch.status !== 'OPEN') {
        return res.status(400).json({ status: 'error', message: 'Lớp học đã đóng đăng ký' });
      }

      actualCourseId = batch.courseId._id;
    }

    // Yêu cầu hồ sơ cá nhân phải có trước khi đăng ký
    const studentDocument = await Document.findOne({ studentId });
    if (!hasCompleteDocumentProfile(studentDocument)) {
      return res.status(400).json({
        status: 'error',
        message: 'Bạn cần nộp đầy đủ hồ sơ (CCCD, khám sức khỏe, ảnh 3x4) trước khi đăng ký lớp',
      });
    }

    // Kiểm tra đăng ký trùng
    const existingRegistration = await Registration.findOne({
      studentId,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING', 'WAITING'] },
      $or: [
        { batchId: batchId || null },
        { courseId: actualCourseId }
      ]
    });

    if (existingRegistration) {
      return res.status(400).json({ status: 'error', message: 'Bạn đã đăng ký khoá học này rồi' });
    }

    // Lấy thông tin course
    const course = await Course.findById(actualCourseId);
    if (!course) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy khoá học' });
    }

    const feePlanSnapshot = buildFeePlanSnapshot(course, paymentPlanType);

    const registration = new Registration({
      studentId,
      courseId: actualCourseId,
      batchId: batchId || null, // Có thể null nếu đăng ký theo course
      registerMethod,
      status: batchId ? 'NEW' : 'WAITING', // Nếu không có batch thì vào danh sách chờ
      paymentPlanType,
      feePlanSnapshot,
    });

    await registration.save();

    await Document.findOneAndUpdate(
      { studentId },
      {
        $set: { registrationId: registration._id },
        $setOnInsert: { studentId, status: 'PENDING' },
      },
      { upsert: true, new: true }
    );

    const result = await Registration.findById(registration._id)
      .populate('studentId', 'fullName phone email')
      .populate('courseId', 'code name estimatedCost')
      .populate('batchId', 'startDate estimatedEndDate location');

    res.status(201).json({ status: 'success', data: result, message: 'Đăng ký thành công' });
  } catch (error) {
    console.error('Create registration error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const assignRegistrationByAdmin = async (req, res) => {
  try {
    const {
      studentId,
      batchId,
      registerMethod = 'CONSULTANT',
      status = 'PROCESSING',
      paymentPlanType = 'INSTALLMENT',
    } = req.body;

    if (!studentId || !batchId) {
      return res.status(400).json({ status: 'error', message: 'studentId và batchId là bắt buộc' });
    }

    const [student, batch] = await Promise.all([
      User.findById(studentId),
      Batch.findById(batchId).populate('courseId'),
    ]);

    if (!student) return res.status(404).json({ status: 'error', message: 'Không tìm thấy học viên' });
    if (student.role !== 'STUDENT') {
      return res.status(400).json({ status: 'error', message: 'User được chọn không phải học viên' });
    }
    if (!batch) return res.status(404).json({ status: 'error', message: 'Không tìm thấy lớp học (batch)' });

    const existingRegistration = await Registration.findOne({
      studentId,
      batchId,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] },
    });

    if (existingRegistration) {
      return res.status(409).json({ status: 'error', message: 'Học viên đã được gán vào lớp này rồi' });
    }

    const feePlanSnapshot = buildFeePlanSnapshot(batch.courseId, paymentPlanType);

    const registration = new Registration({
      studentId,
      batchId,
      registerMethod,
      status,
      paymentPlanType,
      feePlanSnapshot,
    });

    await registration.save();

    await Document.findOneAndUpdate(
      { studentId },
      {
        $set: { registrationId: registration._id },
        $setOnInsert: { studentId, status: 'PENDING' },
      },
      { upsert: true, new: true }
    );

    const result = await Registration.findById(registration._id)
      .populate('studentId', 'fullName phone email')
      .populate({
        path: 'batchId',
        populate: { path: 'courseId', model: Course, select: 'code name estimatedCost feePayments' },
      });

    return res.status(201).json({
      status: 'success',
      message: 'Gán khóa học cho học viên thành công',
      data: result,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getCourseParticipants = async (req, res) => {
  try {
    const { courseId } = req.params;

    const batches = await Batch.find({ courseId }, '_id location startDate estimatedEndDate status').lean();
    const batchIds = batches.map((b) => b._id);

    if (batchIds.length === 0) {
      return res.json({ status: 'success', data: [], count: 0 });
    }

    const registrations = await Registration.find({ batchId: { $in: batchIds } })
      .populate('studentId', 'fullName phone email status')
      .populate({
        path: 'batchId',
        select: 'location startDate estimatedEndDate status courseId',
        populate: { path: 'courseId', select: 'code name' },
      })
      .sort({ createdAt: -1 });

    return res.json({
      status: 'success',
      data: registrations,
      count: registrations.length,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
