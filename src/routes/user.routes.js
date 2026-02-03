import express from 'express';
import { getAllUsers, getUserById, createUser, updateUser, deactivateUser } from '../controllers/user.controller.js';

const router = express.Router();

router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/deactivate', deactivateUser);

export default router;

