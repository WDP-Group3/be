import mongoose from 'mongoose';
import Registration from '../models/Registration.js';
import Document from '../models/Document.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Booking from '../models/Booking.js';
import Payment from '../models/Payment.js';
import Leads from '../models/Leads.js';

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
    const { learnerId, batchId, status, courseId, unassigned, paidFirstInstallment } = req.query;
    const filter = {};

    if (req.user?.role === 'learner') {
      filter.learnerId = req.userId;
    } else if (learnerId) {
      filter.learnerId = learnerId;
    }

    if (courseId) filter.courseId = courseId;
    if (batchId) filter.batchId = batchId;
    if (unassigned === 'true') {
        filter.$or = [
            { batchId: null },
            { batchId: { $exists: false } }
        ];
    }
    if (paidFirstInstallment === 'true') {
      filter.firstPaymentDate = { $exists: true, $ne: null };
    }
    if (status) {
        if (status.includes(',')) {
            filter.status = { $in: status.split(',') };
        } else {
            filter.status = status;
        }
    }

    const registrations = await Registration.find(filter)
      .populate('learnerId', 'fullName phone email')
      .populate('courseId', 'code name estimatedCost feePayments')
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
      .populate('learnerId')
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
    const learnerId = req.userId;

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
    const learnerDocument = await Document.findOne({ learnerId });
    if (!hasCompleteDocumentProfile(learnerDocument)) {
      return res.status(400).json({
        status: 'error',
        message: 'Bạn cần nộp đầy đủ hồ sơ (CCCD, khám sức khỏe, ảnh 3x4) trước khi đăng ký lớp',
      });
    }

    // Kiểm tra đăng ký trùng
    const existingRegistration = await Registration.findOne({
      learnerId,
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
      learnerId,
      courseId: actualCourseId,
      batchId: batchId || null, // Có thể null nếu đăng ký theo course
      registerMethod,
      status: batchId ? 'NEW' : 'WAITING', // Nếu không có batch thì vào danh sách chờ
      paymentPlanType,
      feePlanSnapshot,
    });

    await registration.save();

    await Document.findOneAndUpdate(
      { learnerId },
      {
        $set: { registrationId: registration._id },
        $setOnInsert: { learnerId, status: 'PENDING' },
      },
      { upsert: true, new: true }
    );

    const result = await Registration.findById(registration._id)
      .populate('learnerId', 'fullName phone email')
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
      learnerId,
      batchId,
      registerMethod = 'CONSULTANT',
      status = 'PROCESSING',
      paymentPlanType = 'INSTALLMENT',
    } = req.body;

    if (!learnerId || !batchId) {
      return res.status(400).json({ status: 'error', message: 'learnerId và batchId là bắt buộc' });
    }

    const [learner, batch] = await Promise.all([
      User.findById(learnerId),
      Batch.findById(batchId).populate('courseId'),
    ]);

    if (!learner) return res.status(404).json({ status: 'error', message: 'Không tìm thấy học viên' });
    if (learner.role !== 'learner') {
      return res.status(400).json({ status: 'error', message: 'User được chọn không phải học viên' });
    }
    if (!batch) return res.status(404).json({ status: 'error', message: 'Không tìm thấy lớp học (batch)' });

    const existingRegistration = await Registration.findOne({
      learnerId,
      batchId,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING'] },
    });

    if (existingRegistration) {
      return res.status(409).json({ status: 'error', message: 'Học viên đã được gán vào lớp này rồi' });
    }

    // Tìm xem người này đã đăng ký khoá học này chưa (nhưng chưa có batch)
    let registration = await Registration.findOne({
      learnerId,
      courseId: batch.courseId._id,
      $or: [
        { batchId: null },
        { batchId: { $exists: false } }
      ],
      status: { $in: ['NEW', 'PROCESSING', 'WAITING'] },
    });

    if (registration) {
      // Nếu có rồi thì update batchId
      registration.batchId = batchId;
      registration.status = status;
      registration.registerMethod = registerMethod;
      // Cập nhật lại feeSnapshot nếu cần thiết
      if (registration.feePlanSnapshot?.length === 0) {
          registration.feePlanSnapshot = buildFeePlanSnapshot(batch.courseId, paymentPlanType);
          registration.paymentPlanType = paymentPlanType;
      }
      await registration.save();
    } else {
      // Nếu chưa thì tạo mới (có thể Admin đang thêm thủ công một người mới tinh)
      const feePlanSnapshot = buildFeePlanSnapshot(batch.courseId, paymentPlanType);

      registration = new Registration({
        learnerId,
        courseId: batch.courseId._id,
        batchId,
        registerMethod,
        status,
        paymentPlanType,
        feePlanSnapshot,
      });

      await registration.save();
    }

    await Document.findOneAndUpdate(
      { learnerId },
      {
        $set: { registrationId: registration._id },
        $setOnInsert: { learnerId, status: 'PENDING' },
      },
      { upsert: true, new: true }
    );

    const result = await Registration.findById(registration._id)
      .populate('learnerId', 'fullName phone email')
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

export const getBatchParticipants = async (req, res) => {
  try {
    const { batchId } = req.params;

    const registrations = await Registration.find({ batchId })
      .populate('learnerId', 'fullName phone email status')
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

export const getCourseParticipants = async (req, res) => {
  try {
    const { courseId } = req.params;

    const batches = await Batch.find({ courseId }, '_id location startDate estimatedEndDate status').lean();
    const batchIds = batches.map((b) => b._id);

    if (batchIds.length === 0) {
      return res.json({ status: 'success', data: [], count: 0 });
    }

    const registrations = await Registration.find({ batchId: { $in: batchIds } })
      .populate('learnerId', 'fullName phone email status')
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

// ==========================================
// [MỚI] API lấy danh sách khóa học đã đăng ký và tiến độ học tập
// Giờ hoàn thành = tổng ca học đã được điểm danh (status COMPLETED / attendance PRESENT)
// ==========================================
export const getMyCoursesWithProgress = async (req, res) => {
  try {
    const learnerId = req.userId;
    const learnerObjId = new mongoose.Types.ObjectId(learnerId);

    // Lấy tất cả registration để map batchId -> courseId (dùng khi batch trong booking không tồn tại hoặc bị xóa)
    const registrations = await Registration.find({
      learnerId,
      status: { $in: ['NEW', 'PROCESSING', 'STUDYING', 'COMPLETED'] }
    })
      .populate('courseId', 'code name requiredPracticeHours')
      .populate('batchId', 'location startDate courseId')
      .lean();

    // Map batchId từ registration -> courseId (dùng để map khi batch trong booking không tồn tại)
    const regBatchToCourse = {};
    registrations.forEach((reg) => {
      if (reg.batchId?._id) {
        const bid = reg.batchId._id.toString();
        const cid = reg.courseId?._id?.toString();
        if (bid && cid) regBatchToCourse[bid] = cid;
      }
    });

    // Đếm số giờ đã hoàn thành theo từng courseId
    // Với mỗi booking, ưu tiên lấy courseId từ batch, nếu batch không tồn tại thì map qua registration
    const completedBookingsWithBatch = await Booking.find({
      learnerId: learnerObjId,
      $or: [
        { attendance: 'PRESENT' },
        { status: 'COMPLETED', attendance: { $exists: false } }
      ]
    })
      .select('batchId')
      .lean();

    const tempProgressMap = {};
    let countNoBatch = 0;
    for (const b of completedBookingsWithBatch) {
      if (!b.batchId) {
        countNoBatch++;
        continue;
      }
      // Lookup batch để lấy courseId (batch phải tồn tại trong DB)
      const Batch = mongoose.model('Batch');
      const batch = await Batch.findById(b.batchId).select('courseId').lean();
      if (batch?.courseId) {
        const cid = batch.courseId.toString();
        tempProgressMap[cid] = (tempProgressMap[cid] || 0) + 1;
      } else {
        // Batch không tồn tại trong DB, thử map qua registration
        const cidFromReg = regBatchToCourse[b.batchId.toString()];
        if (cidFromReg) {
          tempProgressMap[cidFromReg] = (tempProgressMap[cidFromReg] || 0) + 1;
        } else {
          countNoBatch++;
        }
      }
    }

    // Các ca không có batch hoặc không map được: gán vào khóa đầu tiên có requiredPracticeHours > 0
    if (countNoBatch > 0) {
      const firstCourseWithRequired = registrations.find(
        (r) => r.courseId && (r.courseId.requiredPracticeHours || 0) > 0
      );
      if (firstCourseWithRequired) {
        const cid = firstCourseWithRequired.courseId._id.toString();
        tempProgressMap[cid] = (tempProgressMap[cid] || 0) + countNoBatch;
      }
    }

    const progressMapByCourseId = tempProgressMap;

    // Số giờ đã hoàn thành theo từng khóa (theo courseId) — mỗi khóa chỉ 1 giá trị, không cộng dồn theo số registration
    const completedByCourseId = { ...progressMapByCourseId };

    // [DEBUG] Log để fix tiến độ học tập - xóa sau khi ổn định
    console.log('[getMyCoursesWithProgress] learnerId:', learnerId);
    console.log('[getMyCoursesWithProgress] completedBookings count:', completedBookingsWithBatch.length);
    console.log('[getMyCoursesWithProgress] progressMapByCourseId:', JSON.stringify(progressMapByCourseId));
    console.log('[getMyCoursesWithProgress] completedByCourseId:', JSON.stringify(completedByCourseId));
    console.log('[getMyCoursesWithProgress] regBatchToCourse:', JSON.stringify(regBatchToCourse));
    console.log(
      '[getMyCoursesWithProgress] registrations:',
      registrations.map((r) => ({
        courseId: r.courseId?._id?.toString(),
        courseCode: r.courseId?.code,
        requiredHours: r.courseId?.requiredPracticeHours,
        batchId: r.batchId?._id?.toString(),
        batchLocation: r.batchId?.location
      }))
    );

    const courseMap = new Map();
    registrations.forEach((reg) => {
      const course = reg.courseId;
      if (!course) return;
      const cid = course._id.toString();
      if (courseMap.has(cid)) return;
      const requiredHours = course.requiredPracticeHours || 0;
      const completedHours = completedByCourseId[cid] || 0;
      const remainingHours = Math.max(0, requiredHours - completedHours);
      courseMap.set(cid, {
        _id: course._id,
        code: course.code,
        name: course.name,
        requiredPracticeHours: requiredHours,
        completedHours,
        remainingHours,
        isCompleted: requiredHours > 0 && remainingHours === 0,
        registrationStatus: reg.status,
        batchLocation: reg.batchId?.location,
        startDate: reg.batchId?.startDate
      });
    });

    const courses = Array.from(courseMap.values());

    console.log(
      '[getMyCoursesWithProgress] final courses (completedHours):',
      courses.map((c) => ({ name: c.name, code: c.code, completedHours: c.completedHours, required: c.requiredPracticeHours }))
    );

    const progress = {};
    courses.forEach((c) => {
      progress[c._id] = {
        required: c.requiredPracticeHours,
        completed: c.completedHours,
        remaining: c.remainingHours,
        isCompleted: c.isCompleted
      };
    });

    res.json({
      status: 'success',
      data: {
        courses,
        progress
      }
    });
  } catch (error) {
    console.error('Error getMyCoursesWithProgress:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const updateOfflinePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { feePlanId } = req.body; // \_id of the feePlanSnapshot item, or name

    const registration = await Registration.findById(id);
    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đăng ký khóa học' });
    }

    if (!registration.feePlanSnapshot) {
      return res.status(400).json({ status: 'error', message: 'Không có dữ liệu đóng học phí' });
    }

    // Find by _id if provided, else by name
    const feeIndex = registration.feePlanSnapshot.findIndex(fp => 
      feePlanId.length === 24 ? fp._id.toString() === feePlanId : fp.name === feePlanId
    );

    if (feeIndex === -1) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy đợt nộp' });
    }

    registration.feePlanSnapshot[feeIndex].paymented = true;
    registration.markModified('feePlanSnapshot');
    await registration.save();

    res.json({
      status: 'success',
      message: `Cập nhật trạng thái nộp tiền thành công cho: ${registration.feePlanSnapshot[feeIndex].name}`
    });
  } catch (error) {
    console.error('Error updateOfflinePayment:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// [MỚI] API lấy danh sách đợt nộp học phí của học viên
// ADMIN: xem tất cả | CONSULTANT: chỉ xem HV được gán qua Leads
// ==========================================
export const getFeeSubmissions = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId).select('role');
    if (!user || !['ADMIN', 'CONSULTANT'].includes(user.role)) {
      return res.status(403).json({ status: 'error', message: 'Forbidden' });
    }

    const {
      page: qPage = 1,
      limit: qLimit = 10,
      search = '',
      courseId = '',
      paymentStatus = '',
      dateFrom = '',
      dateTo = '',
    } = req.query;

    const page = parseInt(qPage);
    const limit = parseInt(qLimit);
    const skip = (page - 1) * limit;

    // Xây dựng filter registration
    const regFilter = {};

    // Phân quyền: CONSULTANT chỉ thấy HV của mình
    if (user.role === 'CONSULTANT') {
      const myLeads = await Leads.find({ assignTo: userId }).select('phone');
      const phones = myLeads.map(l => l.phone).filter(Boolean);
      if (phones.length === 0) {
        return res.json({
          status: 'success',
          data: { items: [], totalFee: 0, paidAmount: 0, remaining: 0 },
          pagination: { total: 0, page, limit, totalPages: 0 },
        });
      }
      // Tìm learner theo phone
      const myLearners = await User.find({ phone: { $in: phones }, role: 'learner' }).select('_id');
      const learnerIds = myLearners.map(u => u._id);
      regFilter.learnerId = { $in: learnerIds };
    }

    if (courseId) regFilter.courseId = courseId;

    // Search theo tên / phone học viên hoặc tên khoá học
    if (search) {
      const matchUsers = await User.find({
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');
      const userIds = matchUsers.map(u => u._id);

      const matchCourses = await Course.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { code: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');
      const courseIds = matchCourses.map(c => c._id);

      const searchCondition = [
        { learnerId: { $in: userIds } },
        { courseId: { $in: courseIds } },
      ];

      regFilter.$and = regFilter.$and || [];
      regFilter.$and.push({ $or: searchCondition });
    }

    // Date filter by createdAt
    if (dateFrom || dateTo) {
      regFilter.createdAt = {};
      if (dateFrom) regFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        regFilter.createdAt.$lte = end;
      }
    }

    const allRegistrations = await Registration.find(regFilter)
      .populate('learnerId', 'fullName phone email avatar')
      .populate({
        path: 'batchId',
        populate: { path: 'courseId', model: Course, select: 'code name estimatedCost feePayments' },
      })
      .populate('courseId', 'code name estimatedCost feePayments')
      .select('+firstPaymentDate')
      .sort({ createdAt: -1 });

    const regIds = allRegistrations.map(r => r._id);
    const allPayments = await Payment.find({ registrationId: { $in: regIds } }).sort({ paidAt: 1 });

    // Map payments by registrationId
    const paymentsByRegId = {};
    for (const p of allPayments) {
      const key = String(p.registrationId);
      if (!paymentsByRegId[key]) paymentsByRegId[key] = [];
      paymentsByRegId[key].push(p);
    }

    // Build items
    let items = allRegistrations.map(registration => {
      const course = registration.batchId?.courseId || registration.courseId;
      const batch = registration.batchId;
      const feePlan = Array.isArray(registration.feePlanSnapshot) && registration.feePlanSnapshot.length > 0
        ? registration.feePlanSnapshot
        : (Array.isArray(course?.feePayments) ? course.feePayments : []);

      const totalFee = feePlan.reduce((s, i) => s + (Number(i.amount) || 0), 0)
        || Number(course?.estimatedCost) || 0;

      const regPayments = paymentsByRegId[String(registration._id)] || [];
      const paidAmount = regPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const remaining = Math.max(totalFee - paidAmount, 0);

      let accumulated = 0;
      let nextSchedule = null;
      for (const item of feePlan) {
        accumulated += Number(item.amount) || 0;
        if (paidAmount < accumulated) { nextSchedule = item; break; }
      }

      const dueDate = nextSchedule?.dueDate || null;
      const isOverdue = remaining > 0 && !!dueDate && new Date(dueDate) < new Date();

      // Tính trạng thái thanh toán
      let status = 'unpaid';
      if (paidAmount >= totalFee && totalFee > 0) status = 'paid';
      else if (paidAmount > 0) status = 'partial';
      if (isOverdue) status = 'overdue';

      return {
        registrationId: registration._id,
        learnerId: registration.learnerId?._id || registration.learnerId,
        learnerName: registration.learnerId?.fullName || '—',
        learnerPhone: registration.learnerId?.phone || '—',
        learnerEmail: registration.learnerId?.email || '—',
        learnerAvatar: registration.learnerId?.avatar || null,
        courseId: course?._id || null,
        courseCode: course?.code || 'N/A',
        courseName: course?.name || 'Khóa học',
        batchId: batch?._id || null,
        batchStartDate: batch?.startDate || null,
        batchEndDate: batch?.estimatedEndDate || null,
        registrationStatus: registration.status,
        paymentPlanType: registration.paymentPlanType,
        totalFee,
        paidAmount,
        remaining,
        dueDate,
        isOverdue,
        paymentStatus: status,
        feePlanSnapshot: feePlan,
        payments: regPayments.map(p => ({
          _id: p._id,
          amount: p.amount,
          method: p.method,
          receivedBy: p.receivedBy,
          paidAt: p.paidAt,
          note: p.note,
        })),
        createdAt: registration.createdAt,
      };
    });

    // Filter by paymentStatus
    if (paymentStatus) {
      items = items.filter(i => i.paymentStatus === paymentStatus);
    }

    const total = items.length;
    const summary = items.reduce(
      (acc, i) => { acc.totalFee += i.totalFee; acc.paidAmount += i.paidAmount; acc.remaining += i.remaining; return acc; },
      { totalFee: 0, paidAmount: 0, remaining: 0 },
    );

    const paginatedItems = items.slice(skip, skip + limit);

    return res.json({
      status: 'success',
      data: {
        items: paginatedItems,
        ...summary,
      },
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error getFeeSubmissions:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
};
