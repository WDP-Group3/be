import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import { getBlogs, getBlogById, createBlog, updateBlog, hideBlog } from '../controllers/blog.controller.js';

const router = express.Router();

// Public routes - không cần authentication
router.get('/', getBlogs);
router.get('/:id', getBlogById);

// Protected routes - cần authentication và ADMIN role
router.post('/', authenticate, requireRole('ADMIN'), createBlog);
router.put('/:id', authenticate, requireRole('ADMIN'), updateBlog);
router.patch("/blogs/hide/:id", authenticate, requireRole('ADMIN'), hideBlog);

export default router;

