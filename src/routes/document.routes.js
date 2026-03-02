import express from 'express';
import {
  getAllDocuments,
  getDocumentById,
  uploadDocuments,
  getDocumentsByRegistration,
  getDocumentsForReview,
  updateDocumentStatus,
} from '../controllers/document.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// Review routes (Sale/Admin)
router.get('/review', authenticate, requireRole('ADMIN', 'CONSULTANT'), getDocumentsForReview);
router.patch('/:id/status', authenticate, requireRole('ADMIN', 'CONSULTANT'), updateDocumentStatus);

// UC10: View Document Status (must be above '/:id' route)
router.get('/registration/:registrationId', authenticate, getDocumentsByRegistration);

router.get('/', getAllDocuments);
router.get('/:id', getDocumentById);
router.post('/upload', authenticate, uploadDocuments); // UC09: Upload Docs

export default router;

