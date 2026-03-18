import express from 'express';
import {
  getAll,
  getAllSimple,
  getById,
  create,
  update,
  remove,
} from '../controllers/examLocation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.get('/simple', getAllSimple);
router.get('/', getAll);
router.get('/:id', getById);

router.post('/', authenticate, requireRole('ADMIN'), create);
router.put('/:id', authenticate, requireRole('ADMIN'), update);
router.delete('/:id', authenticate, requireRole('ADMIN'), remove);

export default router;