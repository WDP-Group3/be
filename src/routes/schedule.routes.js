import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { toggleBusy, getMySchedule, getPublicSchedule, getEmergencyLeaveInfo, testEmergencyBusy, toggleBusyAllDay, getInstructorMonthlyStats } from '../controllers/schedule.controller.js';

const router = express.Router();

router.use(authenticate);

// --- [NEW] Route cho learner lấy lịch (khớp với FE gọi: apiClient.get('/schedule', ...)) ---
router.get('/', getPublicSchedule);

// GV xem lịch & báo bận
router.get('/instructor', requireRole('INSTRUCTOR'), getMySchedule);
router.post('/busy', requireRole('INSTRUCTOR'), toggleBusy);

// [MỚI] Báo bận cả ngày
router.post('/busy-all-day', requireRole('INSTRUCTOR'), toggleBusyAllDay);

// [MỚI] Lấy thông tin nghỉ phép khẩn cấp
router.get('/emergency-leave', requireRole('INSTRUCTOR'), getEmergencyLeaveInfo);

// [MỚI] Lấy thống kê thời gian dạy theo tháng
router.get('/instructor/monthly-stats', requireRole('INSTRUCTOR'), getInstructorMonthlyStats);

// [TEST] API test báo bận khẩn cấp
router.post('/test-emergency', authenticate, testEmergencyBusy);

export default router;
