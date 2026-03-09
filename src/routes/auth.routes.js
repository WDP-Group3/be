import express from 'express';
import { login, register, getProfile, updateProfile, forgotPassword, logout, googleLogin } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';


const router = express.Router();

// Public routes
router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/logout', logout); // Logout route
router.post('/google', googleLogin);


// Protected routes
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);

export default router;
