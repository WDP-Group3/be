import express from 'express';
import { createQR, checkStatus } from '../controllers/transaction.controller.js';

const router = express.Router();

router.post('/create-qr', createQR);
router.get('/check-payment', checkStatus);

export default router;

