import express from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import courseRoutes from './course.routes.js';
import batchRoutes from './batch.routes.js';
import registrationRoutes from './registration.routes.js';
import paymentRoutes from './payment.routes.js';
import documentRoutes from './document.routes.js';
import bookingRoutes from './booking.routes.js';
import examQuestionRoutes from './examQuestion.routes.js';
import examResultRoutes from './examResult.routes.js';
import notificationRoutes from './notification.routes.js';
import bannerRoutes from './banner.routes.js';
import reportRoutes from './report.routes.js';
import feedbackRoutes from './feedback.routes.js';
import blogRoutes from './blog.routes.js';

const router = express.Router();

// Auth routes (no prefix)
router.use('/auth', authRoutes);

// Admin routes (protected, ADMIN role required)
router.use('/admin', adminRoutes);

// Sử dụng routes
router.use('/users', userRoutes);
router.use('/courses', courseRoutes);
router.use('/batches', batchRoutes);
router.use('/blogs', blogRoutes);
router.use('/registrations', registrationRoutes);
router.use('/payments', paymentRoutes);
router.use('/documents', documentRoutes);
router.use('/bookings', bookingRoutes);
router.use('/exam-questions', examQuestionRoutes);
router.use('/exam-results', examResultRoutes);
router.use('/notifications', notificationRoutes);
router.use('/banners', bannerRoutes);
router.use('/reports', reportRoutes);
router.use('/feedbacks', feedbackRoutes);

export default router;

