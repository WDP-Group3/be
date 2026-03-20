import express from 'express';
import {
  getAllBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  autoEnrollBatch
} from '../controllers/batch.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/', getAllBatches);
router.get('/:id', getBatchById);

router.post('/', authenticate, requireRole('ADMIN'), createBatch);
router.put('/:id', authenticate, requireRole('ADMIN'), updateBatch);
router.delete('/:id', authenticate, requireRole('ADMIN'), deleteBatch);
router.post('/:id/auto-enroll', authenticate, requireRole('ADMIN'), autoEnrollBatch);

export default router;
