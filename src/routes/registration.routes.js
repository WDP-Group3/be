import express from 'express';
import { getAllRegistrations, getRegistrationById, createRegistration } from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', getAllRegistrations);
router.get('/:id', getRegistrationById);
router.post('/', authenticate, createRegistration); // UC09: Enroll - yêu cầu authentication

export default router;

