import express from 'express';
import { getRandomExam, getExamQuestionById, getTopics } from '../controllers/examQuestion.controller.js';

const router = express.Router();

router.get('/topics', getTopics);
router.get('/random', getRandomExam);
router.get('/:id', getExamQuestionById);

export default router;

