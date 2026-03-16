import express from 'express';
import { createQR, checkStatus, getTransactionStatus, getTransactions, confirmTransaction } from '../controllers/transaction.controller.js';
import {
  getAllPayments,
  getPaymentById,
  getTuitionInfo,
  createPayment,
  getAiTuitionSuggestion,
  extendDueDateBylearner,
  upsertDueDateByAdmin,
  deletePayment,
} from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/tuition-info', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), getTuitionInfo);
router.post('/ai-suggestion', authenticate, requireRole('ADMIN', 'CONSULTANT', 'learner'), getAiTuitionSuggestion);
router.post('/extend-due-date', authenticate, requireRole('learner'), extendDueDateBylearner);
router.post('/upsert-due-date', authenticate, requireRole('ADMIN', 'CONSULTANT'), upsertDueDateByAdmin);

router.post('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), createPayment);
router.get('/', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), getAllPayments);

router.post('/create-qr', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), createQR);
router.get('/transactions', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), getTransactions);
router.get('/transaction-status/:id', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), getTransactionStatus);
router.patch('/transactions/:id/confirm', authenticate, requireRole('ADMIN', 'CONSULTANT'), confirmTransaction);
router.post('/check-payment', checkStatus);

router.get('/:id', authenticate, requireRole('learner', 'ADMIN', 'CONSULTANT'), getPaymentById);
router.delete('/:id', authenticate, requireRole('ADMIN', 'CONSULTANT'), deletePayment);

export default router;
