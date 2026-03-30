export const buildFeePlanSnapshot = (course, paymentPlanType = 'INSTALLMENT') => {
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
        paymented: false,
      },
    ];
  }

  if (feePayments.length > 0) {
    return feePayments.map((item, idx) => ({
      name: item.name || `Đợt ${idx + 1}`,
      amount: Number(item.amount) || 0,
      dueDate: item.dueDate || null,
      afterPreviousPaidDays: Number(item.afterPreviousPaidDays) || 0,
      note: item.note || '',
      paymented: false,
    }));
  }

  return [
    {
      name: 'Đợt 1',
      amount: totalFee,
      dueDate: null,
      note: 'Mặc định do khóa học chưa cấu hình đợt phí',
      paymented: false,
    },
  ];
};
