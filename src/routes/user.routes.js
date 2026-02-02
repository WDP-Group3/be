import express from 'express';
import { getAllUsers, getUserById, createUser, updateUser, deactivateUser, approveUser, rejectUser, getUserStats } from '../controllers/user.controller.js';

const router = express.Router();

router.get('/stats', getUserStats);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/deactivate', deactivateUser);
router.patch('/:id/approve', approveUser);
router.patch('/:id/reject', rejectUser);

export default router;

