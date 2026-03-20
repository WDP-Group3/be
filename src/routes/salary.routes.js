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

// GET /salary/export-all - Xuất Excel tất cả lương tháng (Admin)
router.get('/export-all', authenticate, requireRole('ADMIN'), salaryController.exportAllSalaryExcel);

// ============================================
// Routes cho override lương/hoa hồng theo user (Admin)
// ============================================
// GET /salary/users/:id/override
router.get('/users/:id/override', authenticate, requireRole('ADMIN'), salaryController.getUserSalaryOverride);

// PUT /salary/users/:id/override
router.put('/users/:id/override', authenticate, requireRole('ADMIN'), salaryController.updateUserSalaryOverride);

// ============================================
// Routes cho user (Instructor/Consultant)
// ============================================
// GET /salary/my - Lương của tôi
router.get('/my', authenticate, salaryController.getMySalary);

// GET /salary/my-export - Export CSV lương của tôi
router.get('/my-export', authenticate, salaryController.exportMySalaryCSV);

// ============================================
// Routes cho cấu hình nghỉ phép (Admin only)
// ============================================
// GET /salary/leave-config - Lấy cấu hình nghỉ phép của năm hiện tại
router.get('/leave-config', authenticate, requireRole('ADMIN'), salaryController.getLeaveConfig);

// PUT /salary/leave-config - Cập nhật cấu hình nghỉ phép
router.put('/leave-config', authenticate, requireRole('ADMIN'), salaryController.updateLeaveConfig);

// GET /salary/leave-usage - Xem usage nghỉ phép của instructors
router.get('/leave-usage', authenticate, requireRole('ADMIN'), salaryController.getLeaveUsage);

// ============================================
// Routes cho cấu hình cột lương động (Admin only)
// ============================================
// GET /salary/columns - Lấy danh sách cột lương
router.get('/columns', authenticate, requireRole('ADMIN'), salaryController.getSalaryColumns);

// POST /salary/columns - Tạo cột lương mới
router.post('/columns', authenticate, requireRole('ADMIN'), salaryController.createSalaryColumn);

// PUT /salary/columns/:id - Cập nhật cột lương
router.put('/columns/:id', authenticate, requireRole('ADMIN'), salaryController.updateSalaryColumn);

// DELETE /salary/columns/:id - Xóa cột lương
router.delete('/columns/:id', authenticate, requireRole('ADMIN'), salaryController.deleteSalaryColumn);

export default router;
