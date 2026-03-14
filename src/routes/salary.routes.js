import express from 'express';
import * as salaryController from '../controllers/salary.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// ============================================
// Routes cho cấu hình lương (Admin only)
// ============================================
// GET /salary/config - Lấy cấu hình hiện tại
router.get('/config', authenticate, requireRole('ADMIN'), salaryController.getSalaryConfig);

// GET /salary/configs - Lấy tất cả cấu hình
router.get('/configs', authenticate, requireRole('ADMIN'), salaryController.getAllSalaryConfigs);

// POST /salary/config - Tạo cấu hình mới
router.post('/config', authenticate, requireRole('ADMIN'), salaryController.createSalaryConfig);

// PUT /salary/config/:id - Cập nhật cấu hình
router.put('/config/:id', authenticate, requireRole('ADMIN'), salaryController.updateSalaryConfig);

// ============================================
// Routes cho danh sách khóa học (dùng cho cột động)
// ============================================
// GET /salary/courses - Lấy danh sách courses
router.get('/courses', authenticate, salaryController.getCoursesForSalary);

// ============================================
// Routes cho tổng lương (Admin)
// ============================================
// GET /salary/monthly-summary - Lấy tổng lương tháng
router.get('/monthly-summary', authenticate, requireRole('ADMIN'), salaryController.getMonthlySummary);

// GET /salary/detail - Lấy chi tiết lương (cho export)
router.get('/detail', authenticate, requireRole('ADMIN'), salaryController.getSalaryDetail);

// GET /salary/export - Xuất CSV
router.get('/export', authenticate, requireRole('ADMIN'), salaryController.exportSalaryCSV);

// ============================================
// Routes cho user (Instructor/Consultant)
// ============================================
// GET /salary/my - Lương của tôi
router.get('/my', authenticate, salaryController.getMySalary);

export default router;
