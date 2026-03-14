import Payment from '../models/Payment.js';
import Registration from '../models/Registration.js';
import Course from '../models/Course.js';
import Invoice from '../models/Invoice.js';
import { enrollSingleStudent } from '../services/enrollment.service.js';

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

    // Tính công nợ real-time dựa trên firstPaymentDate
    let remaining = 0;
    let monthsElapsed = 0;
    if (registration.firstPaymentDate && courseMonths > 0) {
      const firstPayment = new Date(registration.firstPaymentDate);
      const now = new Date();
      if (!isNaN(firstPayment.getTime())) {
        monthsElapsed = (now.getFullYear() - firstPayment.getFullYear()) * 12 + (now.getMonth() - firstPayment.getMonth());
        monthsElapsed = Math.max(monthsElapsed, 0);
        // Công nợ = (Tổng học phí / Số tháng) * Số tháng đã học - Đã đóng
        const tuitionPerMonth = totalFee / courseMonths;
        const calculatedDebt = tuitionPerMonth * monthsElapsed;
        remaining = Math.max(calculatedDebt - paidAmount, 0);
      } else {
        remaining = Math.max(totalFee - paidAmount, 0);
      }
    } else {
      remaining = Math.max(totalFee - paidAmount, 0);
    }

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
      studentId: registration.studentId?._id || registration.studentId,
      studentName: registration.studentId?.fullName || '',
      batchId: batch?._id || null,
      courseId: course?._id || null,
      courseCode: course?.code || 'N/A',
      courseName: course?.name || 'Khóa học',
      courseStartDate: batch?.startDate || null,
      courseEndDate: batch?.estimatedEndDate || null,
      courseMonths,
      firstPaymentDate: registration.firstPaymentDate || null,
      monthsElapsed,
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

    if (!registrationId && req.user?.role === 'STUDENT') {
      const registrations = await Registration.find({ studentId: req.userId }).select('_id');
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
          { path: 'studentId', select: 'fullName phone email' },
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

    const result = await Payment.findById(payment._id).populate('registrationId', 'studentId batchId status');

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

    const enrollResult = await enrollSingleStudent(registrationId);
    console.log('💰 [PAYMENT] Kết quả auto-enroll:', enrollResult);

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
    const targetStudentId = !isAdminOrSale ? req.userId : (req.query.studentId || undefined);

    const filter = targetStudentId ? { studentId: targetStudentId } : {};

    const registrations = await Registration.find(filter)
      .populate('studentId', 'fullName phone email')
      .populate({ path: 'batchId', populate: { path: 'courseId', model: Course } })
      .select('+firstPaymentDate');

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
        },
      });
    }

    const registrationIds = registrations.map((r) => r._id);
    const payments = await Payment.find({ registrationId: { $in: registrationIds } }).sort({ paidAt: 1 });

    const items = buildTuitionItems(registrations, payments);

    const summary = items.reduce(
      (acc, item) => {
        acc.totalFee += item.totalFee;
        acc.paidAmount += item.paidAmount;
        acc.remaining += item.remaining;
        return acc;
      },
      { totalFee: 0, paidAmount: 0, remaining: 0 },
    );

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
        items,
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

export const extendDueDateByStudent = async (req, res) => {
  try {
    const { registrationId, scheduleIndex, extendedDays = 7, reason = '' } = req.body;

    if (!registrationId) {
      return res.status(400).json({ status: 'error', message: 'registrationId là bắt buộc' });
    }

    const registration = await Registration.findOne({ _id: registrationId, studentId: req.userId });
    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy hồ sơ của học viên' });
    }

    if (!Array.isArray(registration.feePlanSnapshot) || registration.feePlanSnapshot.length === 0) {
      return res.status(400).json({ status: 'error', message: 'Hồ sơ chưa có lịch đóng phí để gia hạn' });
    }

    const index = Number.isInteger(scheduleIndex)
      ? scheduleIndex
      : registration.feePlanSnapshot.findIndex((item) => item?.dueDate);

    if (index < 0 || index >= registration.feePlanSnapshot.length) {
      return res.status(400).json({ status: 'error', message: 'scheduleIndex không hợp lệ' });
    }

    const currentDueDate = registration.feePlanSnapshot[index]?.dueDate;
    const baseDate = currentDueDate ? new Date(currentDueDate) : new Date();
    const days = Math.max(1, Math.min(Number(extendedDays) || 7, 30));
    baseDate.setDate(baseDate.getDate() + days);

    registration.feePlanSnapshot[index].dueDate = baseDate;
    registration.feePlanSnapshot[index].note = `${registration.feePlanSnapshot[index].note || ''} | Student xin gia hạn ${days} ngày${reason ? `: ${reason}` : ''}`.trim();
    await registration.save();

    return res.json({ status: 'success', message: 'Gia hạn hạn thanh toán thành công', data: registration.feePlanSnapshot[index] });
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
