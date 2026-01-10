import express from 'express';
import { getAllNotifications, getNotificationById } from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', getAllNotifications);
router.get('/:id', getNotificationById);

export default router;

