import express from 'express';
import { getAllBanners, getBannerById } from '../controllers/banner.controller.js';

const router = express.Router();

router.get('/', getAllBanners);
router.get('/:id', getBannerById);

export default router;

