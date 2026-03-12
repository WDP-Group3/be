import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import {
  getAllHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday
} from '../controllers/systemHoliday.controller.js';

const router = express.Router();

// Tất cả route cần đăng nhập và role ADMIN
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/', getAllHolidays);
router.post('/', createHoliday);
router.put('/:id', updateHoliday);
router.delete('/:id', deleteHoliday);

export default router;
