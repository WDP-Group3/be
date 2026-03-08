import express from 'express';
import {
  getAllRegistrations,
  getRegistrationById,
  createRegistration,
  assignRegistrationByAdmin,
} from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), getAllRegistrations);
router.get('/:id', authenticate, getRegistrationById);
router.post('/', authenticate, createRegistration); // learner tự enroll
router.post('/assign', authenticate, requireRole('ADMIN'), assignRegistrationByAdmin); // admin gán

export default router;
