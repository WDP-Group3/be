import express from 'express';
import { getAllNotifications, getNotificationById, createNotification } from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', getAllNotifications);
router.get('/:id', getNotificationById);
router.post('/', createNotification);

export default router;

