import express from 'express'; 
import { 
  getAllBookings, 
  getBookingById, 
  createBooking, 
  updateBookingStatus, 
  takeAttendance, 
  submitFeedback,
  getBookingStatus,
  testSendAttendanceReminder
} from '../controllers/booking.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// Lấy danh sách & Tạo mới
router.get('/', authenticate, getAllBookings);
router.post('/', authenticate, createBooking);

// Lấy trạng thái mở đăng ký tuần sau (18:30 thứ 6)
router.get('/status', authenticate, getBookingStatus);

// [TEST] Endpoint gửi mail nhắc điểm danh (chỉ dùng khi dev)
router.post('/test-attendance-reminder', testSendAttendanceReminder);

// Các route có ID phải nằm dưới cùng
router.get('/:id', authenticate, getBookingById);
router.put('/:id', authenticate, updateBookingStatus); // [FIX] Đã mở route này
router.patch('/:id/attendance', authenticate, takeAttendance);
router.patch('/:id/feedback', authenticate, submitFeedback);

export default router;