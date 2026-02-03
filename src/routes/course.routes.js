import express from 'express';
import { getAllCourses, getCourseById, createCourse, updateCourse, deleteCourse } from '../controllers/course.controller.js';

const router = express.Router();

router.get('/', getAllCourses);
router.get('/:id', getCourseById);
router.post('/', createCourse);
router.put('/:id', updateCourse);
router.delete('/:id', deleteCourse);

console.log('Course routes loaded');

export default router;

