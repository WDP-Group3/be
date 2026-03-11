import express from 'express';
import {
    getStats,
    getRevenueByMonth,
    getRegistrationStats,
    getPaymentMethodStats,
    getTopCourses,
    getDebtSummary,
    getRecentTransactions,
} from '../controllers/report.controller.js';

const router = express.Router();

router.get('/stats', getStats);
router.get('/revenue-by-month', getRevenueByMonth);
router.get('/registration-stats', getRegistrationStats);
router.get('/payment-method-stats', getPaymentMethodStats);
router.get('/top-courses', getTopCourses);
router.get('/debt-summary', getDebtSummary);
router.get('/recent-transactions', getRecentTransactions);

export default router;
