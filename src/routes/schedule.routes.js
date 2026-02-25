import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { toggleBusy, getMySchedule, getPublicSchedule } from '../controllers/schedule.controller.js';

const router = express.Router();

router.use(authenticate);

// --- [NEW] Route cho Student lấy lịch (khớp với FE gọi: apiClient.get('/schedule', ...)) ---
router.get('/', getPublicSchedule);

// GV xem lịch & báo bận
router.get('/instructor', requireRole('INSTRUCTOR'), getMySchedule);
router.post('/busy', requireRole('INSTRUCTOR'), toggleBusy);

export default router;