import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import Payment from '../models/Payment.js';
import Registration from '../models/Registration.js';
import { enrollSingleLEARNER } from '../services/enrollment.service.js';

const SEPAY_BANK_CODE = process.env.SEPAY_BANK_CODE || '';
const SEPAY_BANK_ACCOUNT = process.env.SEPAY_BANK_ACCOUNT || '';
const SEPAY_ACCOUNT_NAME = process.env.SEPAY_ACCOUNT_NAME || '';
const SEPAY_WEBHOOK_API_KEY = process.env.SEPAY_WEBHOOK_API_KEY || '';

const randomCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const getHeaderApiKey = (req) => {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  if (!auth) return '';
  const [prefix, key] = auth.split(' ');
  const lowerPrefix = String(prefix || '').toLowerCase();
  // SePay gửi "Spikey {API_KEY}" hoặc "ApiKey {API_KEY}"
  if (lowerPrefix === 'apikey' || lowerPrefix === 'spikey') return key || '';
  return auth;
};

export const createQR = async (req, res) => {
  try {
    const { vnp_Amount, vnp_OrderInfo, user, registrationId, scheduleIndex } = req.body;

    const amount = Number(vnp_Amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Số tiền không hợp lệ' });
    }

    const transferContent = `HP-${Date.now()}-${randomCode()}`;

    const transaction = await Transaction.create({
      amount,
      orderInfo: vnp_OrderInfo || '',
      transferContent,
      user: user || req.userId,
      registrationId: registrationId || null,
      scheduleIndex: Number.isInteger(scheduleIndex) ? scheduleIndex : (scheduleIndex !== undefined ? Number(scheduleIndex) : null),
      status: 'pending',
    });

    if (!SEPAY_BANK_CODE || !SEPAY_BANK_ACCOUNT) {
      return res.status(500).json({
        status: 'error',
        message: 'Thiếu cấu hình SEPAY_BANK_CODE hoặc SEPAY_BANK_ACCOUNT trong backend .env',
      });
    }

    const qrPayload = `https://qr.sepay.vn/img?acc=${encodeURIComponent(SEPAY_BANK_ACCOUNT)}&bank=${encodeURIComponent(SEPAY_BANK_CODE)}&amount=${encodeURIComponent(amount)}&des=${encodeURIComponent(transferContent)}`;

    return res.status(201).json({
      status: 'success',
      data: {
        transactionId: transaction._id,
        transferContent,
        amount,
        bankCode: SEPAY_BANK_CODE,
        bankAccount: SEPAY_BANK_ACCOUNT,
        accountName: SEPAY_ACCOUNT_NAME,
        paymentUrl: qrPayload,
      },
      message: 'Tạo QR SePay thành công',
    });
  } catch (error) {
    console.error('Error creating SePay QR:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const checkStatus = async (req, res) => {
  try {
    const incomingKey = getHeaderApiKey(req);
    if (!SEPAY_WEBHOOK_API_KEY || incomingKey !== SEPAY_WEBHOOK_API_KEY) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized webhook' });
    }

    const payload = req.body || {};
    const transferContent = payload.transferContent || payload.content || payload.description || '';
    if (!transferContent) {
      return res.status(400).json({ status: 'error', message: 'Thiếu transferContent' });
    }

    const transaction = await Transaction.findOne({ transferContent, status: { $ne: 'completed' } });
    if (!transaction) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy giao dịch pending' });
    }

    const paidAmount = Number(payload.transferAmount || payload.amount || 0);
    if (paidAmount < Number(transaction.amount || 0)) {
      return res.status(400).json({ status: 'error', message: 'Số tiền nhận nhỏ hơn số tiền yêu cầu' });
    }

    const extractPaidAt = (p) => {
      const candidate =
        p.paidAt || p.paid_at || p.transactionTime || p.transaction_time || p.createdAt || p.created_at || p.time;
      if (!candidate) return null;
      const d = new Date(candidate);
      if (!Number.isNaN(d.getTime())) return d;
      // Some providers send epoch seconds/ms
      const n = Number(candidate);
      if (!Number.isNaN(n) && n > 0) {
        const maybeMs = n > 2_000_000_000 ? n : n * 1000;
        const d2 = new Date(maybeMs);
        if (!Number.isNaN(d2.getTime())) return d2;
      }
      return null;
    };

    transaction.status = 'completed';
    transaction.paidAt = extractPaidAt(payload) || new Date();
    transaction.providerTransactionId = String(payload.id || payload.transactionId || payload.referenceCode || '');
    transaction.rawPayload = payload;
    await transaction.save();

    let paymentCreated = false;
    let enrollment = null;

    if (transaction.registrationId) {
      const note = `SePay auto webhook - ${transaction.transferContent}`;
      const existedPayment = await Payment.findOne({ note });
      if (!existedPayment) {
        await Payment.create({
          registrationId: transaction.registrationId,
          amount: Number(transaction.amount),
          method: 'ONLINE',
          receivedBy: 'SYSTEM',
          paidAt: transaction.paidAt,
          note,
        });
        paymentCreated = true;
      }

      // Auto-enroll & set firstPaymentDate cho payment ĐẦU TIÊN (tự động)
      // Kiểm tra xem registration đã có payment nào chưa
      const existingPaymentCount = await Payment.countDocuments({ registrationId: transaction.registrationId });
      if (existingPaymentCount <= 1) { // <= 1 vì vừa tạo payment ở trên
        const registration = await Registration.findById(transaction.registrationId).select('_id status firstPaymentDate');
        if (registration) {
          // Set firstPaymentDate nếu chưa có (thanh toán lần đầu)
          if (!registration.firstPaymentDate) {
            await Registration.findByIdAndUpdate(registration._id, {
              firstPaymentDate: transaction.paidAt
            });
          }
          // Ensure status progresses once money is received
          if (['NEW', 'WAITING'].includes(registration.status)) {
            await Registration.findByIdAndUpdate(registration._id, { status: 'PROCESSING' });
          }
          enrollment = await enrollSingleLEARNER(registration._id);
        }
      }
    }

    return res.json({ status: 'success', message: 'Đã xác nhận thanh toán SePay', data: { paymentCreated, enrollment } });
  } catch (error) {
    console.error('Error processing SePay webhook:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findById(id).lean();

    if (!transaction) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy giao dịch' });
    }

    const isOwner = String(transaction.user || '') === String(req.userId || '');
    const isAdminOrSale = ['ADMIN', 'CONSULTANT'].includes(req.user?.role);

    if (!isOwner && !isAdminOrSale) {
      return res.status(403).json({ status: 'error', message: 'Bạn không có quyền xem giao dịch này' });
    }

    return res.json({
      status: 'success',
      data: {
        id: transaction._id,
        paymentStatus: transaction.status,
        amount: transaction.amount,
        transferContent: transaction.transferContent,
        paidAt: transaction.paidAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getTransactions = async (req, res) => {
  try {
    const filter = {};
    const { status } = req.query;

    if (status) filter.status = status;

    if (req.user?.role === 'LEARNER') {
      filter.user = req.userId;
    }

    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({ status: 'success', data: transactions });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const confirmTransaction = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy giao dịch' });
    }

    if (transaction.status !== 'completed') {
      transaction.status = 'completed';
      transaction.paidAt = transaction.paidAt || new Date();
      await transaction.save();
    }

    let paymentCreated = false;

    if (transaction.registrationId) {
      const note = `SePay auto webhook - ${transaction.transferContent}`;
      const existedPayment = await Payment.findOne({ note });
      if (!existedPayment) {
        await Payment.create({
          registrationId: transaction.registrationId,
          amount: Number(transaction.amount),
          method: 'ONLINE',
          receivedBy: 'SYSTEM',
          paidAt: transaction.paidAt || new Date(),
          note,
        });
        paymentCreated = true;
      }

      // Set firstPaymentDate cho payment ĐẦU TIÊN (tự động)
      const existingPaymentCount = await Payment.countDocuments({ registrationId: transaction.registrationId });
      if (existingPaymentCount <= 1) {
        const registration = await Registration.findById(transaction.registrationId).select('_id firstPaymentDate status');
        if (registration) {
          if (!registration.firstPaymentDate) {
            await Registration.findByIdAndUpdate(registration._id, {
              firstPaymentDate: transaction.paidAt || new Date()
            });
          }
          // Auto-enroll khi xác nhận thanh toán đầu tiên
          if (['NEW', 'WAITING'].includes(registration.status)) {
            await Registration.findByIdAndUpdate(registration._id, { status: 'PROCESSING' });
            await enrollSingleLEARNER(registration._id);
          }
        }
      }
    }

    return res.json({ status: 'success', message: 'Đã xác nhận giao dịch', data: { transaction, paymentCreated } });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
