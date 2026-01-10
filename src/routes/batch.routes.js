import express from 'express';
import { getAllBatches, getBatchById } from '../controllers/batch.controller.js';

const router = express.Router();

router.get('/', getAllBatches);
router.get('/:id', getBatchById);

export default router;

