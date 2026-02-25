import express from 'express';
import { getAllCourses, getCourseById, createCourse, updateCourse, deleteCourse } from '../controllers/course.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// Public routes - không cần authentication
router.get('/', getAllCourses);
router.get('/:id', getCourseById);

// Protected routes - cần authentication và ADMIN role
router.post('/', authenticate, requireRole('ADMIN'), createCourse);
router.put('/:id', authenticate, requireRole('ADMIN'), updateCourse);
router.delete('/:id', authenticate, requireRole('ADMIN'), deleteCourse);

console.log('Course routes loaded');

export default router;

