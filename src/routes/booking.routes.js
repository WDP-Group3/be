import express from 'express';
import { 
  getAllBookings, 
  getBookingById, 
  createBooking, 
  updateBookingStatus, 
  takeAttendance, 
  submitFeedback
} from '../controllers/booking.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// Lấy danh sách & Tạo mới
router.get('/', authenticate, getAllBookings);
router.post('/', authenticate, createBooking);

// Các route có ID phải nằm dưới cùng
router.get('/:id', authenticate, getBookingById);
router.put('/:id', authenticate, updateBookingStatus); // [FIX] Đã mở route này
router.patch('/:id/attendance', authenticate, takeAttendance);
router.patch('/:id/feedback', authenticate, submitFeedback);

export default router;