import express from 'express';
import {
  getAllRegistrations,
  getRegistrationById,
  createRegistration,
  assignRegistrationByAdmin,
  getCourseParticipants,
  getBatchParticipants,
  getMyCoursesWithProgress,
  updateOfflinePayment,
  getFeeSubmissions,
} from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/fee-submissions', authenticate, requireRole('ADMIN', 'CONSULTANT'), getFeeSubmissions);
router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT', 'learner'), getAllRegistrations);
router.get('/my-courses', authenticate, requireRole('learner'), getMyCoursesWithProgress);
router.get('/:id', authenticate, getRegistrationById);
router.post('/', authenticate, createRegistration); // learner tự enroll
router.post('/assign', authenticate, requireRole('ADMIN'), assignRegistrationByAdmin); // admin gán
router.get('/course/:courseId/participants', authenticate, requireRole('ADMIN', 'CONSULTANT'), getCourseParticipants);
router.get('/batch/:batchId/participants', authenticate, requireRole('ADMIN', 'CONSULTANT'), getBatchParticipants);
router.patch('/:id/offline-payment', authenticate, requireRole('ADMIN', 'CONSULTANT'), updateOfflinePayment);

export default router;
