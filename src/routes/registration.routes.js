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
  unassignRegistration,
} from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/fee-submissions', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getFeeSubmissions);
router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR', 'learner', 'USER'), getAllRegistrations);
router.get('/my-courses', authenticate, requireRole('learner'), getMyCoursesWithProgress);
router.get('/:id', authenticate, getRegistrationById);
router.post('/', authenticate, createRegistration); // learner tự enroll
router.post('/assign', authenticate, requireRole('ADMIN'), assignRegistrationByAdmin); // admin gán
router.get('/course/:courseId/participants', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getCourseParticipants);
router.get('/batch/:batchId/participants', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getBatchParticipants);
router.patch('/:id/offline-payment', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), updateOfflinePayment);
router.patch('/:id/unassign', authenticate, requireRole('ADMIN'), unassignRegistration);

export default router;
