import express from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  getLocations,
  changeUserRole,
  restoreUser,
  getUserStats,
  getInstructorsByLocation,
  getLearnerEnrolledCourses,
  updateLearnerEnrolledCourses,
} from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// ============================================================
// RULES:
// - authenticate: moi route deu phai co
// - requireRole: chi khi can kiem tra role cu the
// - Ownership check: trong controller (users co the truy cap chinh minh)
// ============================================================

// --- STATIC ROUTES (dat TRUOC /:id) ---

// Chi ADMIN moi xem duoc stats
router.get('/stats', authenticate, requireRole('ADMIN'), getUserStats);

// Chi ADMIN + CONSULTANT moi xem duoc danh sach user
router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), getAllUsers);

// Ai cung truy cap duoc (dropdown locations, instructors) — da authenticate
router.get('/locations', authenticate, getLocations);
router.get('/instructors', authenticate, getInstructorsByLocation);

// Chi ADMIN + CONSULTANT moi tao duoc user
router.post('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), createUser);

// --- DYNAMIC ROUTES (dat SAU /:id) ---

// Lay / cap nhat user theo ID — authenticate, ownership check trong controller
router.get('/:id', authenticate, getUserById);
router.patch('/:id', authenticate, updateUser);

// Admin-only actions
router.patch('/:id/deactivate', authenticate, requireRole('ADMIN'), deactivateUser);
router.patch('/:id/restore', authenticate, requireRole('ADMIN'), restoreUser);
router.patch('/:id/change-role', authenticate, requireRole('ADMIN'), changeUserRole);

// Enrolled courses — authenticate, ownership check trong controller
router.get('/:id/enrolled-courses', authenticate, getLearnerEnrolledCourses);
router.patch('/:id/enrolled-courses', authenticate, updateLearnerEnrolledCourses);

export default router;
