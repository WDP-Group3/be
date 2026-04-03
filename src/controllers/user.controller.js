import User from '../models/User.js';
import LearningLocation from '../models/LearningLocation.js';
import Course from '../models/Course.js';
import Registration from '../models/Registration.js';
import Batch from '../models/Batch.js';
import bcrypt from 'bcryptjs';
import Booking from '../models/Booking.js';
import { sendNotificationEmail } from '../services/email.service.js';
import { emitScheduleUpdate } from '../services/socket.service.js';

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
    const { role, status, search, page = 1, limit: limitQuery } = req.query;
    // Khi chỉ lấy INSTRUCTOR (dropdown địa điểm học, v.v.) cần đủ danh sách, không phân trang nhỏ
    const defaultLimit = role === 'INSTRUCTOR' && !limitQuery ? 500 : 10;
    const limit = limitQuery ? parseInt(limitQuery, 10) : defaultLimit;
    const pageNum = parseInt(page, 10) || 1;
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

    const skip = (pageNum - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter)
    ]);

    res.json({
      status: 'success',
      data: formatUserResponse(users),
      pagination: {
        total,
        page: pageNum,
        limit,
        totalPages: Math.ceil(total / limit)
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
      password: hashedPassword,
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

import { buildFeePlanSnapshot } from '../utils/feeHelper.js';

// 4. Update User (Admin) - Cập nhật để sửa email, password, role, name...
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, name, phone, address, gender, dateOfBirth, avatar, workingLocation, role, email, password } = req.body;
    
    // Tìm user trước để kiểm tra tồn tại
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Nếu cập nhật email, kiểm tra xem email mới có bị trùng không
    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(400).json({ status: 'error', message: 'Email đã được sử dụng bởi tài khoản khác' });
      }
      user.email = email.toLowerCase();
    }

    // Cập nhật các trường thông tin cơ bản
    if (fullName) user.fullName = fullName;
    if (name) user.fullName = name; // Map từ 'name' của frontend sang 'fullName'
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (gender) user.gender = gender;
    if (dateOfBirth) user.dateOfBirth = dateOfBirth;
    if (avatar) user.avatar = avatar;
    if (role) user.role = role;
    
    // Cập nhật workingLocation nếu có
    let locationChanged = false;
    const oldLocation = user.workingLocation;

    if (workingLocation && workingLocation !== oldLocation) {
      if (user.role === 'INSTRUCTOR') {
        locationChanged = true;
      }
      user.workingLocation = workingLocation;
    }

    // Nếu có đổi mật khẩu thì hash
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    await user.save();

    // [MỚI] Xử lý huỷ lịch nếu Giáo viên thay đổi khu vực công tác
    if (locationChanged) {
       (async () => {
         try {
           const now = new Date();
           now.setDate(now.getDate() + 1);
           now.setHours(0,0,0,0);
           const affectedBookings = await Booking.find({
              instructorId: user._id,
              date: { $gte: now },
              status: { $ne: 'CANCELLED' }
           }).populate('learnerId', 'email fullName');

           for (const b of affectedBookings) {
              b.status = 'CANCELLED';
              b.instructorNote = 'Hệ thống tự động huỷ lịch giao điểm do giáo viên điều chuyển khu vực công tác.';
              await b.save();
              
              emitScheduleUpdate({
                 instructorId: b.instructorId,
                 learnerId: b.learnerId?._id,
                 date: b.date,
                 timeSlot: b.timeSlot,
                 status: 'CANCELLED'
              });

              if (b.learnerId?.email) {
                 const classStr = new Date(b.date).toLocaleDateString('vi-VN');
                 const title = '⚠️ Thông báo huỷ lịch tập lái - Thay đổi khu vực giáo viên';
                 const ms = `Kính gửi học viên ${b.learnerId.fullName},
                 
Hệ thống đã tự động huỷ ca học thực hành của bạn vào ngày ${classStr} (Ca ${b.timeSlot}) do giáo viên được điều chuyển khu vực công tác.
Bạn vui lòng vào hệ thống để đặt lại lịch học với giáo viên khác tại khu vực của mình nhé.

Trân trọng!`;
                 await sendNotificationEmail(b.learnerId.email, title, ms).catch(() => {});
              }
           }
           
           if (affectedBookings.length > 0 && user.email) {
              const ms = `Kính gửi Thầy/Cô ${user.fullName},

Bạn đã được admin điều chuyển từ khu vực "${oldLocation || 'Không xác định'}" sang "${workingLocation}". 
Hệ thống đã tự động huỷ ${affectedBookings.length} ca tập lái trong vòng tương lai của thầy/cô tại khu vực cũ.

Trân trọng!`;
              await sendNotificationEmail(user.email, 'Thông báo điều chuyển khu vực công tác', ms).catch(()=>{});
           }
         } catch(e) { console.error('Error auto canceling instructor location update:', e); }
       })();
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
    // [FIX] Bỏ logic fallback "xóa điều kiện khóa học nếu không tìm thấy thầy" 
    // để bắt buộc lọc khắt khe theo cả Địa điểm HOẶC Khóa học như yêu cầu.

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

// ==========================================
// [MỚI] QUẢN LÝ HẠNG HỌC VIÊN (learner)
// ==========================================

/**
 * Lấy danh sách hạng học có thể chọn + trạng thái enrolled của 1 learner
 * GET /api/users/:id/enrolled-courses
 */
export const getLearnerEnrolledCourses = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Lấy tất cả khóa học active
    const courses = await Course.find({ status: 'Active' }).lean();

    // enrolledCourseCodes từ User (migrate từ Registration hoặc admin đã set)
    const userEnrolledCodes = new Set(user.enrolledCourseCodes || []);

    // Với mỗi course trên hệ thống, xác định trạng thái
    const courseStatuses = await Promise.all(
      courses.map(async (course) => {
        // Kiểm tra Registration: đã thanh toán chưa?
        const reg = await Registration.findOne({
          learnerId: id,
          courseId: course._id,
          firstPaymentDate: { $ne: null },
        }).lean();

        const paid = !!reg;

        // inBatch = đã thanh toán + có batch OPEN
        let inBatch = false;
        if (reg?.batchId) {
          const batch = await Batch.findById(reg.batchId).lean();
          if (batch && batch.status === 'OPEN') {
            inBatch = true;
          }
        }

        // enrolled = đã lưu trong User.enrolledCourseCodes
        // (dù chưa thanh toán vẫn hiện, để admin thấy và chỉnh sửa)
        const enrolled = userEnrolledCodes.has(course.code);

        return {
          _id: course._id,
          code: course.code,
          name: course.name,
          enrolled,
          paid,
          inBatch,
        };
      }),
    );

    res.json({
      status: 'success',
      data: {
        enrolledCourseCodes: user.enrolledCourseCodes || [],
        courses: courseStatuses,
      },
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * Cập nhật danh sách hạng học của learner
 * PATCH /api/users/:id/enrolled-courses
 * Body: { enrolledCourseCodes: ["A1", "B2"] }
 */
export const updateLearnerEnrolledCourses = async (req, res) => {
  try {
    const { id } = req.params;
    const { enrolledCourseCodes } = req.body;

    if (!Array.isArray(enrolledCourseCodes)) {
      return res.status(400).json({ status: 'error', message: 'enrolledCourseCodes phải là array' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    // Lấy tất cả khóa học active để validate
    const allCourses = await Course.find({ status: 'Active' }).lean();
    const courseCodesMap = new Map(allCourses.map((c) => [c.code, c]));

    // Validate: chỉ chấp nhận course codes hợp lệ
    const validRequestedCodes = enrolledCourseCodes.filter((code) => courseCodesMap.has(code));

    // Định nghĩa các nhóm category
    const XE_MAY_REGEX = /^A[12]$/;
    const O_TO_REGEX = /^[BCDEF]/; // B1, B2, C, D, E...

    const requestedXeMay = validRequestedCodes.filter(c => XE_MAY_REGEX.test(c));
    const requestedOTo = validRequestedCodes.filter(c => O_TO_REGEX.test(c));

    // Rule: Chỉ được chọn tối đa 1 hạng trong mỗi nhóm
    if (requestedXeMay.length > 1) {
      return res.status(400).json({ status: 'error', message: 'Xe Máy chỉ được chọn tối đa 1 hạng (A1 hoặc A2)' });
    }
    if (requestedOTo.length > 1) {
      return res.status(400).json({ status: 'error', message: 'Ô Tô chỉ được chọn tối đa 1 hạng (B1, B2, C...)' });
    }

    // Kiểm tra trạng thái hiện tại của user để xác định cái gì đang bị "khóa" (đã vào lớp)
    const currentEnrolledCodes = user.enrolledCourseCodes || [];
    const lockedCodes = [];
    
    for (const code of currentEnrolledCodes) {
      const course = courseCodesMap.get(code);
      if (!course) continue;

      // Tìm registration tương ứng xem đã vào lớp (Batch OPEN) chưa
      const reg = await Registration.findOne({
        learnerId: id,
        courseId: course._id,
        batchId: { $ne: null },
      }).lean();

      if (reg?.batchId) {
        const batch = await Batch.findById(reg.batchId).lean();
        if (batch && batch.status === 'OPEN') {
          lockedCodes.push(code);
        }
      }
    }

    // Nếu có code bị khóa, thì trong nhóm (category) đó, user PHẢI giữ nguyên code cũ
    const currentXeMay = currentEnrolledCodes.filter(c => XE_MAY_REGEX.test(c))[0];
    const currentOTo = currentEnrolledCodes.filter(c => O_TO_REGEX.test(c))[0];

    const isXeMayLocked = lockedCodes.some(c => XE_MAY_REGEX.test(c));
    const isOToLocked = lockedCodes.some(c => O_TO_REGEX.test(c));

    if (isXeMayLocked && requestedXeMay[0] !== currentXeMay) {
      return res.status(400).json({ 
        status: 'error', 
        message: `Không thể thay đổi hạng Xe máy (${currentXeMay}) vì học viên đã được xếp lớp.` 
      });
    }

    if (isOToLocked && requestedOTo[0] !== currentOTo) {
      return res.status(400).json({ 
        status: 'error', 
        message: `Không thể thay đổi hạng Ô tô (${currentOTo}) vì học viên đã được xếp lớp.` 
      });
    }

    // --- SYNC REGISTRATIONS ---
    const handleCategorySync = async (oldCode, newCode, regex) => {
      // 1. Trường hợp xóa hạng (có cũ, không có mới)
      if (oldCode && !newCode) {
        const oldCourse = courseCodesMap.get(oldCode);
        if (oldCourse) {
          // Cancel registration cũ
          await Registration.updateMany(
            { learnerId: id, courseId: oldCourse._id, status: { $ne: 'CANCELLED' } },
            { $set: { status: 'CANCELLED' } }
          );
        }
      }
      // 2. Trường hợp đổi hạng (có cũ, có mới và khác nhau)
      else if (oldCode && newCode && oldCode !== newCode) {
        const oldCourse = courseCodesMap.get(oldCode);
        const newCourse = courseCodesMap.get(newCode);
        if (oldCourse && newCourse) {
          // Tìm registration cũ để cập nhật thành mới
          const oldReg = await Registration.findOne({ 
            learnerId: id, 
            courseId: oldCourse._id,
            status: { $ne: 'CANCELLED' }
          });
          
          if (oldReg) {
            oldReg.courseId = newCourse._id;
            // Rebuild fee plan based on new course
            oldReg.feePlanSnapshot = buildFeePlanSnapshot(newCourse, oldReg.paymentPlanType);
            await oldReg.save();
          } else {
            // Nếu không tìm thấy reg cũ (lỗi dữ liệu?), tạo cái mới
            const registration = new Registration({
              learnerId: id,
              courseId: newCourse._id,
              registerMethod: 'CONSULTANT',
              status: 'DRAFT',
              paymentPlanType: 'INSTALLMENT',
              feePlanSnapshot: buildFeePlanSnapshot(newCourse, 'INSTALLMENT'),
            });
            await registration.save();
          }
        }
      }
      // 3. Trường hợp thêm mới (không có cũ, có mới)
      else if (!oldCode && newCode) {
        const newCourse = courseCodesMap.get(newCode);
        if (newCourse) {
          // Kiểm tra xem đã có reg cho cái này chưa
          const existing = await Registration.findOne({ 
            learnerId: id, 
            courseId: newCourse._id,
            status: { $ne: 'CANCELLED' }
          });
          if (!existing) {
            const registration = new Registration({
              learnerId: id,
              courseId: newCourse._id,
              registerMethod: 'CONSULTANT',
              status: 'DRAFT',
              paymentPlanType: 'INSTALLMENT',
              feePlanSnapshot: buildFeePlanSnapshot(newCourse, 'INSTALLMENT'),
            });
            await registration.save();
          }
        }
      }
    };

    await handleCategorySync(currentXeMay, requestedXeMay[0], XE_MAY_REGEX);
    await handleCategorySync(currentOTo, requestedOTo[0], O_TO_REGEX);

    // Cập nhật User
    user.enrolledCourseCodes = validRequestedCodes;
    await user.save();

    res.json({
      status: 'success',
      data: {
        enrolledCourseCodes: user.enrolledCourseCodes,
      },
      message: 'Cập nhật hạng học thành công',
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

