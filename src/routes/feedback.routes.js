import express from 'express';
import { getFeedbacks, createFeedback, updateFeedback, updateFeedbackStatus } from '../controllers/feedback.controller.js';

const router = express.Router();

router.get('/', getFeedbacks);
router.post('/', createFeedback);
router.put('/:id', updateFeedback);
router.patch('/:id/status', updateFeedbackStatus);

export default router;
