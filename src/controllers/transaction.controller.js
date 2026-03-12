import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import Payment from '../models/Payment.js';

const SEPAY_BANK_CODE = process.env.SEPAY_BANK_CODE || '';
const SEPAY_BANK_ACCOUNT = process.env.SEPAY_BANK_ACCOUNT || '';
const SEPAY_ACCOUNT_NAME = process.env.SEPAY_ACCOUNT_NAME || '';
const SEPAY_WEBHOOK_API_KEY = process.env.SEPAY_WEBHOOK_API_KEY || '';

const randomCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const getHeaderApiKey = (req) => {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  if (!auth) return '';
  const [prefix, key] = auth.split(' ');
  if (String(prefix || '').toLowerCase() === 'apikey') return key || '';
  return auth;
};

export const createQR = async (req, res) => {
  try {
    const { vnp_Amount, vnp_OrderInfo, user, registrationId } = req.body;

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

    transaction.status = 'completed';
    transaction.paidAt = new Date();
    transaction.providerTransactionId = String(payload.id || payload.transactionId || payload.referenceCode || '');
    transaction.rawPayload = payload;
    await transaction.save();

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
          paidAt: transaction.paidAt,
          note,
        });
        paymentCreated = true;
      }
    }

    return res.json({ status: 'success', message: 'Đã xác nhận thanh toán SePay', data: { paymentCreated } });
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

    if (req.user?.role === 'STUDENT') {
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
    }

    return res.json({ status: 'success', message: 'Đã xác nhận giao dịch', data: { transaction, paymentCreated } });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
