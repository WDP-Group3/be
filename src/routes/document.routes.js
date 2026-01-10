import express from 'express';
import { getAllDocuments, getDocumentById } from '../controllers/document.controller.js';

const router = express.Router();

router.get('/', getAllDocuments);
router.get('/:id', getDocumentById);

export default router;

