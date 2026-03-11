import express from 'express';
import { getAllNotifications, getNotificationById, createNotification, updateNotification, deleteNotification, markNotificationRead } from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', getAllNotifications);
router.get('/:id', getNotificationById);
router.post('/', createNotification);
router.put('/:id', updateNotification);
router.patch('/:id/read', markNotificationRead);
router.delete('/:id', deleteNotification);

export default router;

