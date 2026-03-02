import express from 'express';
import { createQR, checkStatus } from '../controllers/transaction.controller.js';
import {
  getAllPayments,
  getPaymentById,
  getTuitionInfo,
  createPayment,
  getAiTuitionSuggestion,
  extendDueDateByStudent,
  upsertDueDateByAdmin,
  deletePayment,
} from '../controllers/payment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/tuition-info', authenticate, requireRole('STUDENT', 'ADMIN', 'CONSULTANT'), getTuitionInfo);
router.post('/ai-suggestion', authenticate, requireRole('ADMIN', 'CONSULTANT', 'STUDENT'), getAiTuitionSuggestion);
router.post('/extend-due-date', authenticate, requireRole('STUDENT'), extendDueDateByStudent);
router.post('/upsert-due-date', authenticate, requireRole('ADMIN', 'CONSULTANT'), upsertDueDateByAdmin);

router.post('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), createPayment);
router.get('/', authenticate, requireRole('STUDENT', 'ADMIN', 'CONSULTANT'), getAllPayments);
router.get('/:id', authenticate, requireRole('STUDENT', 'ADMIN', 'CONSULTANT'), getPaymentById);
router.delete('/:id', authenticate, requireRole('ADMIN', 'CONSULTANT'), deletePayment);

router.post('/create-qr', createQR);
router.get('/check-payment', checkStatus);

export default router;
