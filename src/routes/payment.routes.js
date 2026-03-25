import express from 'express';
import { createQR, checkStatus, getTransactionStatus, getTransactions, confirmTransaction } from '../controllers/transaction.controller.js';
import {
  getAllPayments,
  getPaymentById,
  getTuitionInfo,
  createPayment,
  getAiTuitionSuggestion,
  upsertDueDateByAdmin,
  deletePayment,
} from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/tuition-info', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getTuitionInfo);
router.post('/ai-suggestion', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR', 'learner', 'USER'), getAiTuitionSuggestion);
router.post('/upsert-due-date', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), upsertDueDateByAdmin);

router.post('/', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), createPayment);
router.get('/', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getAllPayments);

router.post('/create-qr', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), createQR);
router.get('/transactions', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getTransactions);
router.get('/transaction-status/:id', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getTransactionStatus);
router.patch('/transactions/:id/confirm', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), confirmTransaction);
router.post('/check-payment', checkStatus);

router.get('/:id', authenticate, requireRole('learner', 'USER', 'ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getPaymentById);
router.delete('/:id', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), deletePayment);

export default router;
