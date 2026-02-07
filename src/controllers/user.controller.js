import User from '../models/User.js';
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
  const userObj = user.toObject ? user.toObject() : user;
  const { password, ...userWithoutPassword } = userObj;
  return userWithoutPassword;
};

// Get user stats
export const getUserStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({
      role: { $in: ['STUDENT', 'INSTRUCTOR', 'CONSULTANT'] }
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
    const { role, status, search } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (status) filter.status = status;

    // Search by name or email
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({
      status: 'success',
      data: formatUserResponse(users),
      count: users.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy user theo ID
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.json({
      status: 'success',
      data: formatUserResponse(user),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};


// Create User (Admin)
export const createUser = async (req, res) => {
  try {
    const { fullName, email, phone, role, password } = req.body;

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
      password: hashedPassword,
      status: 'ACTIVE'
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

// Update User (Admin)
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    // Hash password if updating
    if (body.password) {
      body.password = await bcrypt.hash(body.password, 10);
    }

    const user = await User.findByIdAndUpdate(id, body, { new: true });

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

// Deactivate User (Admin)
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

// Change User Role (Admin)
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ status: 'error', message: 'Role is required' });
    }

    // Validate role
    const validRoles = ['ADMIN', 'STUDENT', 'INSTRUCTOR', 'CONSULTANT'];
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
