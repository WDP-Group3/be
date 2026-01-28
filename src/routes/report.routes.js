import express from 'express';
import { getStats } from '../controllers/report.controller.js';

const router = express.Router();

router.get('/stats', getStats);

export default router;
