import express from 'express';
import { getAllRegistrations, getRegistrationById } from '../controllers/registration.controller.js';

const router = express.Router();

router.get('/', getAllRegistrations);
router.get('/:id', getRegistrationById);

export default router;

