import { addDays } from './dateHelper.js';

/**
 * Tạo snapshot đợt đóng tiền cho Registration.
 * Tự tính dueDate dựa trên afterPreviousPaidDays nếu Course không có sẵn dueDate.
 *
 * Logic ưu tiên:
 *   1. feePayments[i].dueDate  → dùng trực tiếp
 *   2. prevDueDate + (afterPreviousPaidDays || 7)
 *   3. Đợt 1: baseDate
 *
 * @param {object} course - Course document
 * @param {string} paymentPlanType - 'INSTALLMENT' | 'FULL'
 * @param {Date|string} baseDate - Ngày gốc để tính hạn (thường là createdAt của Registration)
 */
export const buildFeePlanSnapshot = (course, paymentPlanType = 'INSTALLMENT', baseDate = new Date()) => {
  const feePayments = Array.isArray(course?.feePayments) ? course.feePayments : [];
  const totalFromInstallments = feePayments.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const fallbackCost = Number(course?.estimatedCost) || 0;
  const totalFee = totalFromInstallments > 0 ? totalFromInstallments : fallbackCost;

  if (paymentPlanType === 'FULL') {
    return [
      {
        name: 'Đóng 1 lần',
        amount: totalFee,
        dueDate: addDays(baseDate, 7),
        note: 'Thanh toán toàn bộ học phí 1 lần',
        paymented: false,
      },
    ];
  }

  if (feePayments.length > 0) {
    let prevDueDate = baseDate;
    return feePayments.map((item, idx) => {
      let dueDate;
      if (item.dueDate) {
        // Ưu tiên: dùng dueDate từ Course
        dueDate = new Date(item.dueDate);
      } else {
        // Không có: dueDate = prevDueDate + (afterPreviousPaidDays || 7)
        const daysToAdd = Number(item.afterPreviousPaidDays) || 7;
        dueDate = addDays(prevDueDate, daysToAdd);
      }
      prevDueDate = dueDate;

      return {
        name: item.name || `Đợt ${idx + 1}`,
        amount: Number(item.amount) || 0,
        dueDate,
        afterPreviousPaidDays: Number(item.afterPreviousPaidDays) || 0,
        note: item.note || '',
        paymented: false,
      };
    });
  }

  // Fallback: không có feePayments → 1 đợt, hạn = baseDate + 7
  return [
    {
      name: 'Đợt 1',
      amount: totalFee,
      dueDate: addDays(baseDate, 7),
      note: 'Mặc định do khóa học chưa cấu hình đợt phí',
      paymented: false,
    },
  ];
};
