import express from 'express';
import { getAllExamResults, getExamResultById, submitExam } from '../controllers/examResult.controller.js';

const router = express.Router();

router.post('/submit', submitExam);
router.get('/', getAllExamResults);
router.get('/:id', getExamResultById);

export default router;

