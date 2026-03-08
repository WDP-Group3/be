import express from 'express';
import {
  getAllDocuments,
  getDocumentById,
  uploadDocuments,
  getDocumentsByRegistration,
  getDocumentsForReview,
  updateDocumentStatus,
  getMyDocument,
  softDeleteDocument,
} from '../controllers/document.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// Review routes (Sale/Admin)
router.get('/review', authenticate, requireRole('ADMIN', 'CONSULTANT'), getDocumentsForReview);
router.patch('/:id/status', authenticate, requireRole('ADMIN', 'CONSULTANT'), updateDocumentStatus);
router.patch('/:id/soft-delete', authenticate, requireRole('ADMIN', 'CONSULTANT'), softDeleteDocument);

// Hồ sơ dùng chung theo user hiện tại
router.get('/me', authenticate, getMyDocument);

// Giữ tương thích API cũ
router.get('/registration/:registrationId', authenticate, getDocumentsByRegistration);

router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT'), getAllDocuments);
router.get('/:id', authenticate, getDocumentById);
router.post('/upload', authenticate, uploadDocuments);

export default router;
