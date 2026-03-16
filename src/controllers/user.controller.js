import User from '../models/User.js';
import LearningLocation from '../models/LearningLocation.js';
import bcrypt from 'bcryptjs';

// Helper function to format user response (remove password)
const formatUserResponse = (user) => {
  if (Array.isArray(user)) {
    return user.map(u => {
      const userObj = u.toObject ? u.toObject() : u;
      const { password, ...userWithoutPassword } = userObj;
      return userWithoutPassword;
    });
  }
  // Check if user is null/undefined
  if (!user) return null;
  
  const userObj = user.toObject ? user.toObject() : user;
  const { password, ...userWithoutPassword } = userObj;
  return userWithoutPassword;
};

// Get user stats
export const getUserStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({
      role: { $in: ['learner', 'INSTRUCTOR', 'CONSULTANT'] }
    });

    res.json({
      status: 'success',
      data: {
        totalUsers
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Lấy tất cả users
export const getAllUsers = async (req, res) => {
  try {
    const { role, status, search, page = 1, limit = 10 } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (status) filter.status = status;
    
    // Thêm tính năng tìm kiếm (Search)
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      User.countDocuments(filter)
    ]);
    
    res.json({
      status: 'success',
      data: formatUserResponse(users),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 2. Lấy user theo ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 3. Create User (Admin) - Cập nhật để lưu workingLocation
export const createUser = async (req, res) => {
  try {
    const { fullName, email, phone, role, password, workingLocation } = req.body;

    // Check existing
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }]
    });
    if (existingUser) {
      return res.status(400).json({ status: 'error', message: 'Email hoặc số điện thoại đã tồn tại' });
    }

    // Default password '11111111@' per requirements if not provided
    const finalPassword = password || '11111111@';
    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    // Auto-fill required fields if missing (since Admin form only asks for Email)
    const finalFullName = fullName || "New User";
    const finalPhone = phone || "0000000000";

    const newUser = new User({
      fullName: finalFullName,
      email: email.toLowerCase(),
      phone: finalPhone,
      role,
      password: finalPassword, // Nên hash password ở đây hoặc trong pre-save hook của Model
      status: 'ACTIVE',
      // Chỉ lưu workingLocation nếu role là INSTRUCTOR
      workingLocation: role === 'INSTRUCTOR' ? workingLocation : undefined
    });

    await newUser.save();

    res.status(201).json({
      status: 'success',
      data: formatUserResponse(newUser),
      message: 'Tạo user thành công'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 4. Update User (Admin) - Cập nhật để sửa workingLocation
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, address, gender, dateOfBirth, avatar, workingLocation, role } = req.body;
    
    // Tạo object update data để kiểm soát những gì được sửa
    const updateData = { fullName, phone, address, gender, dateOfBirth, avatar };

    // Nếu có gửi role lên thì cập nhật role
    if (role) updateData.role = role;

    // Cập nhật workingLocation
    if (workingLocation) {
        updateData.workingLocation = workingLocation;
    }

    const user = await User.findByIdAndUpdate(id, updateData, { new: true });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
      message: 'Cập nhật user thành công'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 5. Deactivate User (Admin)
export const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(id, { status: 'INACTIVE' }, { new: true });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
      message: 'Đã khoá tài khoản user'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// ==========================================
// [NEW FEATURES] API CHO VIỆC LỌC GIÁO VIÊN
// ==========================================

// 6. Lấy danh sách các Khu vực (từ Địa điểm học; fallback từ User.workingLocation)
export const getLocations = async (req, res) => {
  try {
    const fromLearning = await LearningLocation.find().distinct('areaName');
    if (fromLearning && fromLearning.length > 0) {
      return res.json({ status: 'success', data: fromLearning });
    }
    const locations = await User.find({
      role: 'INSTRUCTOR',
      status: 'ACTIVE',
      workingLocation: { $ne: null },
    }).distinct('workingLocation');
    res.json({ status: 'success', data: locations });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
// Change User Role (Admin)
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ status: 'error', message: 'Role is required' });
    }

    // Validate role
    const validRoles = ['ADMIN', 'learner', 'INSTRUCTOR', 'CONSULTANT'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ status: 'error', message: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
      message: `Đã thay đổi quyền thành ${role}`
    });
    } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
  

// 7. Lấy Giáo viên theo Khu vực và Khóa học (từ Địa điểm học - LearningLocation)
// Luồng: học viên chọn khu vực → chọn khóa đã đăng ký → lọc giáo viên dạy khóa đó tại khu vực đó
export const getInstructorsByLocation = async (req, res) => {
  try {
    const { location, courseId, courses } = req.query;
    const courseIds = courseId ? [courseId] : (courses && typeof courses === 'string' ? courses.split(',').map(s => s.trim()).filter(Boolean) : []);

    // Ưu tiên: lấy từ LearningLocation (địa điểm học có gán thầy + khóa)
    if (location && location.trim() && courseIds.length > 0) {
      const locDocs = await LearningLocation.find({
        areaName: { $regex: new RegExp(`^${String(location).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }).lean();
      const allInstructorIds = new Set();
      for (const locDoc of locDocs) {
        if (locDoc.instructors && locDoc.instructors.length > 0) {
          locDoc.instructors
            .filter((i) => courseIds.some((cid) => (i.courseId?.toString?.() || i.courseId) === cid))
            .forEach((i) => allInstructorIds.add(i.instructorId?.toString?.() || i.instructorId));
        }
      }
      if (allInstructorIds.size > 0) {
        const users = await User.find({ _id: { $in: [...allInstructorIds] }, role: 'INSTRUCTOR', status: 'ACTIVE' });
        return res.json({ status: 'success', data: formatUserResponse(users) });
      }
    }

    // Fallback: lọc User theo workingLocation + taughtCourses
    let filter = { role: 'INSTRUCTOR', status: 'ACTIVE' };
    if (location && location.trim()) {
      filter.workingLocation = { $regex: new RegExp(`^${String(location).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
    }
    if (courseIds.length > 0) filter.taughtCourses = { $in: courseIds };

    let instructors = await User.find(filter);
    if (instructors.length === 0 && courseIds.length > 0) {
      delete filter.taughtCourses;
      instructors = await User.find(filter);
    }

    res.json({ status: 'success', data: formatUserResponse(instructors) });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
// Restore User (Admin) - Unlock account
export const restoreUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndUpdate(id, { status: 'ACTIVE' }, { new: true });

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
      message: 'Đã khôi phục tài khoản user'
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

