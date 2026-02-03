import express from 'express';
import { getAllUsers, getUserById, createUser, updateUser, deactivateUser, changeUserRole, restoreUser, getUserStats } from '../controllers/user.controller.js';

const router = express.Router();

router.get('/stats', getUserStats);
router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/deactivate', deactivateUser);
router.patch('/:id/restore', restoreUser);
router.patch('/:id/change-role', changeUserRole);

export default router;


