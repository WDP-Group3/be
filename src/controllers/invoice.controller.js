import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import Registration from '../models/Registration.js';

const buildInvoiceNo = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${yyyy}${mm}${dd}-${rand}`;
};

export const createInvoiceFromPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId).populate('registrationId');
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Payment not found' });
    }

    const existed = await Invoice.findOne({ paymentId: payment._id });
    if (existed) {
      return res.json({ status: 'success', data: existed, message: 'Invoice already exists' });
    }

    const registration = await Registration.findById(payment.registrationId?._id || payment.registrationId);
    if (!registration) {
      return res.status(404).json({ status: 'error', message: 'Registration not found' });
    }

    const invoice = await Invoice.create({
      invoiceNo: buildInvoiceNo(),
      paymentId: payment._id,
      registrationId: registration._id,
      learnerId: registration.learnerId,
      amount: Number(payment.amount) || 0,
      note: payment.note || '',
      issuedAt: new Date(),
    });

    return res.status(201).json({
      status: 'success',
      message: 'Tạo hóa đơn thành công',
      data: invoice,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getInvoices = async (req, res) => {
  try {
    const { registrationId, learnerId } = req.query;
    const filter = {};

    if (registrationId) filter.registrationId = registrationId;
    if (learnerId) filter.learnerId = learnerId;

    const invoices = await Invoice.find(filter)
      .populate('paymentId', 'amount method paidAt')
      .populate('learnerId', 'fullName email phone')
      .sort({ issuedAt: -1 });

    return res.json({
      status: 'success',
      data: invoices,
      count: invoices.length,
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
