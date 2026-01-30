import express from 'express';
import { getAllLeads, createLead, assignLead } from '../controllers/lead.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authenticate, getAllLeads);
router.post('/', createLead);
router.patch('/:leadId/assign', authenticate, assignLead);

export default router;
