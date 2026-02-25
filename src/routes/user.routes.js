import express from 'express';
import { 
  getAllUsers, 
  getUserById, 
  createUser, 
  updateUser, 
  deactivateUser,
  // Bổ sung 2 hàm mới này vào import để không bị lỗi undefined
  getLocations,
  getInstructorsByLocation 
} from '../controllers/user.controller.js';

const router = express.Router();

// --- KHU VỰC 1: CÁC ROUTE CỤ THỂ (STATIC ROUTES) ---
// Phải đặt những route này LÊN TRÊN route /:id
// Nếu không Express sẽ hiểu nhầm "locations" là một cái "id"

router.get('/', getAllUsers);

// API lấy danh sách khu vực (cho dropdown filter)
router.get('/locations', getLocations);

// API lọc giáo viên theo khu vực
router.get('/instructors', getInstructorsByLocation);

router.post('/', createUser);

// --- KHU VỰC 2: CÁC ROUTE ĐỘNG (DYNAMIC ROUTES) ---
// Các route có tham số :id phải đặt dưới cùng

router.get('/:id', getUserById);
router.put('/:id', updateUser);
router.patch('/:id/deactivate', deactivateUser);

export default router;