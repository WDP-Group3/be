import express from 'express';
import { getFeedbacks, createFeedback } from '../controllers/feedback.controller.js';

const router = express.Router();

router.get('/', getFeedbacks);
router.post('/', createFeedback);

export default router;
