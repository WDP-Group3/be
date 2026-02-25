import User from '../models/User.js';

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

// 1. Lấy tất cả users (Có hỗ trợ Search và Filter)
export const getAllUsers = async (req, res) => {
  try {
    const { role, status, search } = req.query;
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

    const users = await User.find(filter).sort({ createdAt: -1 });
    
    res.json({
      status: 'success',
      data: formatUserResponse(users),
      count: users.length,
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

    const finalPassword = password || '123456';

    const newUser = new User({
      fullName,
      email: email.toLowerCase(),
      phone,
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

// 6. Lấy danh sách các Khu vực hoạt động (Distinct Locations)
export const getLocations = async (req, res) => {
  try {
    // Lấy tất cả các workingLocation khác null/rỗng của Instructor đang Active
    const locations = await User.find({ 
      role: 'INSTRUCTOR', 
      status: 'ACTIVE',
      workingLocation: { $ne: null } 
    }).distinct('workingLocation');
    
    res.json({ status: 'success', data: locations });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// 7. Lấy Giáo viên theo Khu vực
export const getInstructorsByLocation = async (req, res) => {
  try {
    const { location } = req.query;
    
    if (!location) {
      return res.status(400).json({ status: 'error', message: 'Vui lòng chọn khu vực' });
    }

    const instructors = await User.find({
      role: 'INSTRUCTOR',
      status: 'ACTIVE',
      workingLocation: location
    });

    res.json({ status: 'success', data: formatUserResponse(instructors) });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};