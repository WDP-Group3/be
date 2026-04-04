import express from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  getAllDocuments,
  getDocumentById,
  uploadDocuments,
  uploadDocumentsMultipart,
  getDocumentsByRegistration,
  getDocumentsForReview,
  updateDocumentStatus,
  getMyDocument,
  softDeleteDocument,
  lookupConsultantByEmail,
} from '../controllers/document.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

// --- Multer: disk storage for document uploads ---
const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const documentFileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Chỉ chấp nhận file: ${allowed.join(', ')}`), false);
  }
};

const documentUpload = multer({
  storage: documentStorage,
  fileFilter: documentFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// --- Routes ---

// Review routes (Sale/Admin)
router.get('/review', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getDocumentsForReview);
router.get('/consultants/lookup', authenticate, lookupConsultantByEmail);
router.patch('/:id/status', authenticate, requireRole('CONSULTANT', 'INSTRUCTOR'), updateDocumentStatus);
router.patch('/:id/soft-delete', authenticate, requireRole('CONSULTANT', 'INSTRUCTOR'), softDeleteDocument);

// Hồ sơ dùng chung theo user hiện tại
router.get('/me', authenticate, getMyDocument);

// Giữ tương thích API cũ
router.get('/registration/:registrationId', authenticate, getDocumentsByRegistration);

router.get('/', authenticate, requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getAllDocuments);
router.get('/:id', authenticate, getDocumentById);

// Server-side upload: FE gửi file → BE upload lên Cloudinary
// fields: cccdImageFront, cccdImageBack, healthCertificate, photo
// body: cccdNumber, consultantEmail
router.post(
  '/upload',
  authenticate,
  documentUpload.fields([
    { name: 'cccdImageFront', maxCount: 1 },
    { name: 'cccdImageBack', maxCount: 1 },
    { name: 'healthCertificate', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
  ]),
  uploadDocumentsMultipart
);

export default router;
