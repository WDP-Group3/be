import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { getBlogs, getBlogById, createBlog, updateBlog, hideBlog, getAllBlogsAdmin, unhideBlog } from '../controllers/blog.controller.js';

const router = express.Router();

// Public routes - không cần authentication
router.get('/', getBlogs);
router.get('/:id', getBlogById);

// Protected routes - cần authentication và ADMIN role
router.get('/admin/all', authenticate, requireRole('ADMIN'), getAllBlogsAdmin);
router.post('/', authenticate, requireRole('ADMIN'), createBlog);
router.put('/:id', authenticate, requireRole('ADMIN'), updateBlog);
router.patch('/hide/:id', authenticate, requireRole('ADMIN'), hideBlog);
router.patch('/unhide/:id', authenticate, requireRole('ADMIN'), unhideBlog);

export default router;

