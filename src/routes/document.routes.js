import express from 'express';
import { getAllDocuments, getDocumentById, uploadDocuments, getDocumentsByRegistration } from '../controllers/document.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', getAllDocuments);
router.get('/:id', getDocumentById);
router.get('/registration/:registrationId', authenticate, getDocumentsByRegistration); // UC10: View Document Status
router.post('/upload', authenticate, uploadDocuments); // UC09: Upload Docs

export default router;

