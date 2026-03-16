import express from 'express';
import {
  getLocations as getLocationNames,
  getAll,
  getById,
  create,
  update,
  remove,
  addInstructor,
  removeInstructor,
} from '../controllers/learningLocation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';

const router = express.Router();

router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/', getAll);
router.get('/list-names', getLocationNames);
router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);
router.post('/:id/instructors', addInstructor);
router.delete('/:id/instructors/:instructorId', removeInstructor);

export default router;
