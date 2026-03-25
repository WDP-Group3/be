import crypto from 'crypto';
import Transaction from '../models/Transaction.js';
import Payment from '../models/Payment.js';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import { enrollSinglelearner } from '../services/enrollment.service.js';

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

    // Hủy các transaction pending cũ của cùng registration (chỉ giữ 1 pending duy nhất)
    if (registrationId) {
      const oldPending = await Transaction.find({
        registrationId,
        status: 'pending',
      });
      if (oldPending.length > 0) {
        await Transaction.updateMany(
          { _id: { $in: oldPending.map(t => t._id) } },
          { status: 'cancelled' },
        );
        console.log(`[createQR] Đã hủy ${oldPending.length} transaction pending cũ cho registration ${registrationId}`);
      }
    }

    const transaction = await Transaction.create({
      amount,
      orderInfo: vnp_OrderInfo || '',
      transferContent,
      user: user || req.userId,
      registrationId: registrationId || null,
      scheduleIndex: Number.isInteger(scheduleIndex) ? scheduleIndex : (scheduleIndex !== undefined ? Number(scheduleIndex) : null),
      status: 'pending',
      // ── ACID: idempotencyKey = _id để webhook có thể check nhanh
      idempotencyKey: null, // sẽ set sau khi có _id
    });
    // Cập nhật idempotencyKey = transaction._id
    transaction.idempotencyKey = String(transaction._id);
    await transaction.save();

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
    console.log('📥 [SEPAY WEBHOOK] Received payload:', JSON.stringify(payload));

    const transferContent = payload.transferContent || payload.content || payload.description || '';
    if (!transferContent) {
      return res.status(400).json({ status: 'error', message: 'Thiếu transferContent' });
    }

    // Tìm transaction: ưu tiên exact match, nếu không thì match prefix (SePay có thể thêm text vào description)
    // Chuẩn hóa: bỏ dấu - trong transferContent để so sánh
    const normalizeContent = (content) => {
      if (!content) return '';
      return content.replace(/-/g, '').split(' ')[0].toUpperCase();
    };

    // Tìm KHÔNG filter theo status để handle cả completed transactions (idempotency check)
    let transaction = await Transaction.findOne({ transferContent });

    // Nếu tìm thấy mà đã completed → idempotent skip
    if (transaction?.status === 'completed') {
      if (transaction.paymentId) {
        console.log(`⏭️ [SEPAY] Transaction ${transaction._id} đã xử lý trước đó (idempotent skip)`);
        return res.json({ status: 'success', message: 'Đã xử lý rồi', data: { paymentCreated: false, alreadyProcessed: true } });
      }
      // Completed nhưng chưa có paymentId → hoặc là cũ hoặc data không nhất quán → vẫn xử lý tiếp
      console.log(`⚠️ [SEPAY] Transaction ${transaction._id} completed nhưng chưa có paymentId → xử lý lại`);
    }

    if (!transaction) {
      // Thử tìm theo normalized content
      const normalizedTransfer = normalizeContent(transferContent);
      console.log('🔍 [SEPAY] Searching with normalized:', normalizedTransfer);

      // Lấy tất cả transaction chưa xử lý và so sánh
      const pendingTransactions = await Transaction.find({ status: { $ne: 'completed' } });
      for (const tx of pendingTransactions) {
        if (!tx.transferContent) continue;
        const normalizedDb = normalizeContent(tx.transferContent);
        console.log(`   Comparing: ${normalizedTransfer} vs ${normalizedDb} => ${normalizedTransfer === normalizedDb}`);
        if (normalizedTransfer === normalizedDb) {
          transaction = tx;
          break;
        }
      }
    }

    if (transaction) {
      console.log('✅ [SEPAY] Found transaction:', transaction.transferContent, 'amount:', transaction.amount, '| status:', transaction.status);
    }

    if (!transaction) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy giao dịch', received: transferContent });
    }

    // ── ACID: Idempotency check — nếu đã có paymentId thì bỏ qua ──
    if (transaction.paymentId) {
      console.log(`⏭️ [SEPAY] Transaction ${transaction._id} đã xử lý trước đó (idempotent skip)`);
      return res.json({ status: 'success', message: 'Đã xử lý rồi', data: { paymentCreated: false, alreadyProcessed: true } });
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
      const n = Number(candidate);
      if (!Number.isNaN(n) && n > 0) {
        const maybeMs = n > 2_000_000_000 ? n : n * 1000;
        const d2 = new Date(maybeMs);
        if (!Number.isNaN(d2.getTime())) return d2;
      }
      return null;
    };

    const paidAt = extractPaidAt(payload) || new Date();

    // ── ACID Phase 1: Tạo Payment ──────────────────────────────────
    const payment = await Payment.create({
      registrationId: transaction.registrationId,
      amount: Number(transaction.amount),
      method: 'ONLINE',
      receivedBy: 'SYSTEM',
      paidAt,
      note: `SePay webhook - ${transaction.transferContent}`,
    });

    // ── ACID Phase 2: Update Transaction với paymentId (liên kết) ──
    transaction.paymentId = payment._id;
    transaction.status = 'completed';
    transaction.paidAt = paidAt;
    transaction.providerTransactionId = String(payload.id || payload.transactionId || payload.referenceCode || '');
    transaction.rawPayload = payload;
    await transaction.save();

    let enrollment = null;

    // ── ACID Phase 3: Xử lý post-payment (idempotent operations) ───
    if (transaction.registrationId) {
      // 3a: Set firstPaymentDate + chuyển role USER → learner (idempotent)
      const registration = await Registration.findById(transaction.registrationId).select('_id status firstPaymentDate learnerId');
      if (registration) {
        const updates = {};

        if (!registration.firstPaymentDate) {
          updates.firstPaymentDate = paidAt;
          // Chuyển role USER → learner
          const user = await User.findById(registration.learnerId);
          if (user && user.role === 'USER') {
            user.role = 'learner';
            await user.save();
            console.log(`✅ [SEPAY] Đã chuyển user ${user.email} từ USER → learner`);
          }
        }
        if (['DRAFT', 'NEW', 'WAITING'].includes(registration.status)) {
          updates.status = 'PROCESSING';
        }
        if (Object.keys(updates).length > 0) {
          await Registration.findByIdAndUpdate(registration._id, updates);
        }
      }

      // 3b: Auto-enroll (idempotent — check batchId exists)
      enrollment = await enrollSinglelearner(transaction.registrationId);

      // 3c: Emit real-time (fire & forget)
      if (global.io && registration?.learnerId) {
        global.io.to(`user:${registration.learnerId}`).emit('payment-success', {
          registrationId: transaction.registrationId,
          amount: transaction.amount,
          paidAt,
          enrollment
        });
        console.log(`💰 Emitted payment-success to user:${registration.learnerId}`);
      }
    }

    return res.json({ status: 'success', message: 'Đã xác nhận thanh toán SePay', data: { paymentCreated: true, enrollment } });
  } catch (error) {
    console.error('Error processing SePay webhook:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

export const getTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📊 [GET TRANSACTION STATUS] id:', id, 'user:', req.userId);
    const transaction = await Transaction.findById(id).lean();
    console.log('📊 [GET TRANSACTION STATUS] transaction:', transaction);

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
        registrationId: transaction.registrationId,
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

    if (req.user?.role === 'learner' || req.user?.role === 'USER') {
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

    // ── ACID: Idempotency check ──────────────────────────────
    if (transaction.paymentId) {
      console.log(`⏭️ [CONFIRM] Transaction ${transaction._id} đã xử lý trước đó (idempotent skip)`);
      return res.json({ status: 'success', message: 'Đã xác nhận rồi', data: { paymentCreated: false, alreadyProcessed: true } });
    }

    const paidAt = transaction.paidAt || new Date();

    // ── ACID Phase 1: Tạo Payment ──────────────────────────────────
    const payment = await Payment.create({
      registrationId: transaction.registrationId,
      amount: Number(transaction.amount),
      method: 'ONLINE',
      receivedBy: 'SYSTEM',
      paidAt,
      note: `Admin xác nhận - ${transaction.transferContent}`,
    });

    // ── ACID Phase 2: Update Transaction với paymentId ──────────────
    transaction.paymentId = payment._id;
    transaction.status = 'completed';
    transaction.paidAt = paidAt;
    await transaction.save();

    // ── ACID Phase 3: Xử lý post-payment (idempotent operations) ───
    let enrollment = null;

    if (transaction.registrationId) {
      // 3a: Set firstPaymentDate + chuyển role USER → learner
      const registration = await Registration.findById(transaction.registrationId).select('_id status firstPaymentDate learnerId');
      if (registration) {
        const updates = {};

        if (!registration.firstPaymentDate) {
          updates.firstPaymentDate = paidAt;
          const user = await User.findById(registration.learnerId);
          if (user && user.role === 'USER') {
            user.role = 'learner';
            await user.save();
            console.log(`✅ [CONFIRM] Đã chuyển user ${user.email} từ USER → learner`);
          }
        }
        if (['DRAFT', 'NEW', 'WAITING'].includes(registration.status)) {
          updates.status = 'PROCESSING';
        }
        if (Object.keys(updates).length > 0) {
          await Registration.findByIdAndUpdate(registration._id, updates);
        }
      }

      // 3b: Auto-enroll (idempotent)
      enrollment = await enrollSinglelearner(transaction.registrationId);

      // 3c: Emit real-time
      if (global.io && registration?.learnerId) {
        global.io.to(`user:${registration.learnerId}`).emit('payment-success', {
          registrationId: transaction.registrationId,
          amount: transaction.amount,
          paidAt,
          enrollment
        });
        console.log(`💰 Emitted payment-success to user:${registration.learnerId}`);
      }
    }

    return res.json({ status: 'success', message: 'Đã xác nhận giao dịch', data: { paymentCreated: true, enrollment } });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
