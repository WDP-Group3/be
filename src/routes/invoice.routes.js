import express from 'express';
import { createInvoiceFromPayment, getInvoices } from '../controllers/invoice.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT', 'LEARNER'), getInvoices);
router.post('/from-payment/:paymentId', authenticate, requireRole('ADMIN', 'CONSULTANT'), createInvoiceFromPayment);

export default router;
