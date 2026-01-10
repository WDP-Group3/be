import express from 'express';
import { getAllPayments, getPaymentById } from '../controllers/payment.controller.js';

const router = express.Router();

router.get('/', getAllPayments);
router.get('/:id', getPaymentById);

export default router;

