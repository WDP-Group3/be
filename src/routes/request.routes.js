import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/role.middleware.js';
import {
    createRequest,
    getAllRequests,
    getMyRequests,
    updateRequestStatus,
} from '../controllers/request.controller.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(authenticate);

// User routes
router.post('/', createRequest);
router.get('/my-requests', getMyRequests);

// Admin/Consultant routes
router.get('/', requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), getAllRequests);
router.put('/:id/status', requireRole('ADMIN', 'CONSULTANT', 'INSTRUCTOR'), updateRequestStatus);

export default router;
