import Payment from '../models/Payment.js';
import Registration from '../models/Registration.js';
import Course from '../models/Course.js';
import Invoice from '../models/Invoice.js';
import { enrollSinglelearner } from '../services/enrollment.service.js';

const getFeePlanFromRegistration = (registration) => {
  const course = registration?.batchId?.courseId;
  const fromSnapshot = Array.isArray(registration?.feePlanSnapshot) ? registration.feePlanSnapshot : [];

  if (fromSnapshot.length > 0) return fromSnapshot;

  const courseFeePayments = Array.isArray(course?.feePayments) ? course?.feePayments : [];
  return courseFeePayments.map((item, idx) => ({
    name: item.name || `Đợt ${idx + 1}`,
    amount: Number(item.amount) || 0,
    dueDate: item.dueDate || null,
    note: item.note || '',
  }));
};

const buildTuitionItems = (registrations, payments) => {
  return registrations.map((registration) => {
    const batch = registration.batchId;
    const course = batch?.courseId;

    const feePlan = getFeePlanFromRegistration(registration);
    const totalFromPlan = feePlan.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const fallbackCourseCost = Number(course?.estimatedCost) || 0;
    const totalFee = totalFromPlan > 0 ? totalFromPlan : fallbackCourseCost;

    const regPayments = payments.filter((p) => String(p.registrationId) === String(registration._id));
    const paidAmount = regPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    // Tính số tháng khóa học từ batch
    let courseMonths = 0;
    if (batch?.startDate && batch?.estimatedEndDate) {
      const start = new Date(batch.startDate);
      const end = new Date(batch.estimatedEndDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        courseMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        courseMonths = Math.max(courseMonths, 1); // Tối thiểu 1 tháng
      }
    }

    // Tính công nợ: Tổng phí - Đã đóng
    let remaining = Math.max(totalFee - paidAmount, 0);

    let accumulated = 0;
    let nextSchedule = null;
    for (const item of feePlan) {
      accumulated += Number(item.amount) || 0;
      if (paidAmount < accumulated) {
        nextSchedule = item;
        break;
      }
    }

    const dueDate = nextSchedule?.dueDate || null;
    const isOverdue = remaining > 0 && !!dueDate && new Date(dueDate) < new Date();

    return {
      registrationId: registration._id,
      learnerId: registration.learnerId?._id || registration.learnerId,
      learnerName: registration.learnerId?.fullName || '',
      phone: registration.learnerId?.phone || '',
      email: registration.learnerId?.email || '',
      batchId: batch?._id || null,
      batchName: batch?.name || 'Chưa gán lớp',
      courseId: course?._id || null,
      courseCode: course?.code || 'N/A',
      courseName: course?.name || 'Khóa học',
      courseStartDate: batch?.startDate || null,
      courseEndDate: batch?.estimatedEndDate || null,
      courseMonths,
      firstPaymentDate: registration.firstPaymentDate || null,
      paymentPlanType: registration.paymentPlanType || 'INSTALLMENT',
      totalFee,
      paidAmount,
      remaining,
      dueDate,
      isOverdue,
      paymentSchedule: feePlan,
    };
  });
};

export const getAllPayments = async (req, res) => {
  try {
    const { registrationId, method } = req.query;
    const filter = {};

    if (registrationId) filter.registrationId = registrationId;
    if (method) filter.method = method;

    if (!registrationId && req.user?.role === 'learner') {
      const registrations = await Registration.find({ learnerId: req.userId }).select('_id');
      const registrationIds = registrations.map((r) => r._id);
      if (registrationIds.length === 0) {
        return res.json({ status: 'success', data: [], count: 0 });
      }
      filter.registrationId = { $in: registrationIds };
    }

    const payments = await Payment.find(filter)
      .populate({
        path: 'registrationId',
        populate: [
          { path: 'learnerId', select: 'fullName phone email' },
          { path: 'batchId', populate: { path: 'courseId', select: 'code name' } },
        ],
      })
      .sort({ paidAt: -1 });

    res.json({ status: 'success', data: payments, count: payments.length });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id).populate('registrationId');

    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Payment not found' });
    }

    res.json({ status: 'success', data: payment });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const deletePayment = async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Payment not found' });
    }

    await Invoice.deleteMany({ paymentId: payment._id });
    await Payment.findByIdAndDelete(id);

    return res.json({
      status: 'success',
      message: 'Đã xóa giao dịch học phí',
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const createPayment = async (req, res) => {
  try {
    const { registrationId, amount, method = 'TRANSFER', receivedBy = 'CONSULTANT', paidAt, note = '' } = req.body;

    if (!registrationId || !amount) {
      return res.status(400).json({ status: 'error', message: 'registrationId và amount là bắt buộc' });
    }

    const registration = await Registration.findById(registrationId)
      .populate({
        path: 'batchId',
        populate: { path: 'courseId', model: Course },
      })
      .select('+firstPaymentDate');

    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Registration not found' });
    }

    const feePlan = getFeePlanFromRegistration(registration);
    const totalFee = feePlan.reduce((sum, p) => sum + (Number(p.amount) || 0))
      || Number(registration.batchId?.courseId?.estimatedCost)
      || 0;

    const paidSoFar = await Payment.aggregate([
      { $match: { registrationId: registration._id } },
      { $group: { _id: '$registrationId', total: { $sum: '$amount' } } },
    ]);
    const paidAmount = Number(paidSoFar?.[0]?.total || 0);
    const remaining = Math.max(totalFee - paidAmount, 0);

    if (Number(amount) > remaining) {
      return res.status(400).json({ status: 'error', message: `Số tiền thu vượt công nợ còn lại (${remaining})` });
    }

    const payment = await Payment.create({
      registrationId,
      amount: Number(amount),
      method,
      receivedBy,
      paidAt: paidAt ? new Date(paidAt) : new Date(),
      note,
    });

    const result = await Payment.findById(payment._id).populate('registrationId', 'learnerId batchId status');

    // 🔄 Tự động set firstPaymentDate nếu chưa có (thanh toán đợt 1)
    if (!registration.firstPaymentDate) {
      await Registration.findByIdAndUpdate(registrationId, {
        firstPaymentDate: paidAt ? new Date(paidAt) : new Date()
      });
    }

    // 🔄 Tự động cập nhật trạng thái và gán học viên vào lớp nếu chưa được gán
    // Chuyển NEW/WAITING -> PROCESSING khi đã thanh toán
    if (['NEW', 'WAITING'].includes(registration.status)) {
      await Registration.findByIdAndUpdate(registrationId, { status: 'PROCESSING' });
    }

    const enrollResult = await enrollSinglelearner(registrationId);
    console.log('💰 [PAYMENT] Kết quả auto-enroll:', enrollResult);

    // Emit real-time notification to user
    if (global.io && registration.learnerId) {
      global.io.to(`user:${registration.learnerId}`).emit('payment-success', {
        registrationId,
        amount: payment.amount,
        paidAt: payment.paidAt,
        enrollment: enrollResult
      });
      console.log(`💰 Emitted payment-success to user:${registration.learnerId}`);
    }

    return res.status(201).json({
      status: 'success',
      message: 'Tạo giao dịch học phí thành công',
      data: result,
      enrollment: enrollResult
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getTuitionInfo = async (req, res) => {
  try {
    const isAdminOrSale = ['ADMIN', 'CONSULTANT'].includes(req.user?.role);
    const targetlearnerId = !isAdminOrSale ? req.userId : (req.query.learnerId || undefined);

    const { 
      search, 
      courseId, 
      status, 
      dateFrom, 
      dateTo,
      page: qPage,
      limit: qLimit
    } = req.query;

    const page = parseInt(qPage) || 1;
    const limit = parseInt(qLimit) || 10;
    const skip = (page - 1) * limit;

    const filter = targetlearnerId ? { learnerId: targetlearnerId } : {};

    // Note: Filtering by Learner name/Course name requires populating or aggregation.
    // To keep it simple but functional, let's fetch matching Learner IDs if search is provided.
    console.log('[tuition-info] Search:', search);
    if (search) {
      const matchingUsers = await User.find({
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');
      const userIds = matchingUsers.map(u => u._id);
      console.log('[tuition-info] Matching users:', userIds.length);

      // Also search by Course code/name
      const matchingCourses = await Course.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { code: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');
      const courseIds = matchingCourses.map(c => c._id);
      console.log('[tuition-info] Matching courses:', courseIds.length);

      // Chỉ thêm filter nếu có kết quả
      if (userIds.length > 0 || courseIds.length > 0) {
        const orConditions = [];
        if (userIds.length > 0) {
          orConditions.push({ learnerId: { $in: userIds } });
        }
        if (courseIds.length > 0) {
          orConditions.push({ courseId: { $in: courseIds } });
        }
        if (orConditions.length > 0) {
          filter.$or = orConditions;
        }
      }
    }

    if (courseId) filter.courseId = courseId;

    let registrations = await Registration.find(filter)
      .populate('learnerId', 'fullName phone email')
      .populate({ path: 'batchId', populate: { path: 'courseId', model: Course } })
      .select('+firstPaymentDate')
      .sort({ createdAt: -1 });

    if (!registrations.length) {
      return res.json({
        status: 'success',
        data: {
          totalFee: 0,
          paidAmount: 0,
          remaining: 0,
          dueDate: null,
          canPayNow: false,
          isOverdue: false,
          items: [],
          pagination: { total: 0, page, limit, totalPages: 0 }
        },
      });
    }

    const registrationIds = registrations.map((r) => r._id);
    const allPayments = await Payment.find({ registrationId: { $in: registrationIds } }).sort({ paidAt: 1 });

    let items = buildTuitionItems(registrations, allPayments);

    // Filter by status if provided (status is calculated in buildTuitionItems)
    console.log('[tuition-info] Status filter:', status, '| Items before filter:', items.length);
    if (status) {
      switch (status) {
        case 'paid':
          items = items.filter(i => i.remaining <= 0);
          break;
        case 'partial':
          items = items.filter(i => i.remaining > 0 && i.paidAmount > 0);
          break;
        case 'unpaid':
          items = items.filter(i => i.paidAmount <= 0);
          break;
        case 'overdue':
          items = items.filter(i => i.isOverdue);
          break;
      }
      console.log('[tuition-info] Items after filter:', items.length);
    }

    if (dateFrom) {
      items = items.filter(i => i.dueDate && new Date(i.dueDate) >= new Date(dateFrom));
    }
    if (dateTo) {
      items = items.filter(i => i.dueDate && new Date(i.dueDate) <= new Date(dateTo));
    }

    const total = items.length;
    const summary = items.reduce(
      (acc, item) => {
        acc.totalFee += item.totalFee;
        acc.paidAmount += item.paidAmount;
        acc.remaining += item.remaining;
        return acc;
      },
      { totalFee: 0, paidAmount: 0, remaining: 0 },
    );

    // Paginate items
    const paginatedItems = items.slice(skip, skip + limit);

    const nextDueDate = items
      .filter((item) => item.remaining > 0 && item.dueDate)
      .map((item) => new Date(item.dueDate))
      .sort((a, b) => a - b)[0] || null;

    res.json({
      status: 'success',
      data: {
        ...summary,
        dueDate: nextDueDate,
        canPayNow: summary.remaining > 0,
        isOverdue: items.some((item) => item.isOverdue),
        items: paginatedItems,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getAiTuitionSuggestion = async (req, res) => {
  try {
    const { totalFee = 0, paidAmount = 0, remaining = 0 } = req.body || {};
    const remainingValue = Number(remaining) || Math.max(Number(totalFee) - Number(paidAmount), 0);

    const suggestion = {
      message:
        remainingValue > 0
          ? 'Đề xuất chia 2 đợt để giảm áp lực tài chính: 60% trong kỳ này, 40% trong kỳ kế tiếp.'
          : 'Học viên đã hoàn thành học phí. Đề xuất xuất biên nhận hoàn tất.',
      plan:
        remainingValue > 0
          ? [
              { name: 'Đợt đề xuất 1', amount: Math.round(remainingValue * 0.6) },
              { name: 'Đợt đề xuất 2', amount: remainingValue - Math.round(remainingValue * 0.6) },
            ]
          : [],
    };

    return res.json({ status: 'success', data: suggestion });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const upsertDueDateByAdmin = async (req, res) => {
  try {
    const { registrationId, scheduleIndex, dueDate, name, amount, note = '' } = req.body;

    if (!registrationId || !dueDate) {
      return res.status(400).json({ status: 'error', message: 'registrationId và dueDate là bắt buộc' });
    }

    const registration = await Registration.findById(registrationId);
    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Registration not found' });
    }

    const normalizedDate = new Date(dueDate);
    if (Number.isNaN(normalizedDate.getTime())) {
      return res.status(400).json({ status: 'error', message: 'dueDate không hợp lệ' });
    }

    if (!Array.isArray(registration.feePlanSnapshot)) {
      registration.feePlanSnapshot = [];
    }

    if (Number.isInteger(scheduleIndex) && scheduleIndex >= 0 && scheduleIndex < registration.feePlanSnapshot.length) {
      registration.feePlanSnapshot[scheduleIndex].dueDate = normalizedDate;
      if (name) registration.feePlanSnapshot[scheduleIndex].name = name;
      if (amount !== undefined) registration.feePlanSnapshot[scheduleIndex].amount = Number(amount) || 0;
      if (note) registration.feePlanSnapshot[scheduleIndex].note = note;
    } else {
      registration.feePlanSnapshot.push({
        name: name || `Đợt ${registration.feePlanSnapshot.length + 1}`,
        amount: Number(amount) || 0,
        dueDate: normalizedDate,
        note,
      });
    }

    await registration.save();

    return res.json({ status: 'success', message: 'Cập nhật hạn thanh toán thành công', data: registration.feePlanSnapshot });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
