import express from 'express';
import { getAllBookings, getBookingById } from '../controllers/booking.controller.js';

const router = express.Router();

router.get('/', getAllBookings);
router.get('/:id', getBookingById);

export default router;

