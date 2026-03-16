import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../services/email.service.js";
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Helper function to generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
};

// Helper function to format user response (remove password)
const formatUserResponse = (user) => {
  const userObj = user.toObject ? user.toObject() : user;
  const { password, ...userWithoutPassword } = userObj;
  return userWithoutPassword;
};

export const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    // Lấy thông tin từ payload của Google
    const { email, sub: googleId, name, picture } = ticket.getPayload();

    let user = await User.findOne({ email });

    if (user) {
      if (user.status === "INACTIVE") {
        return res.status(403).json({
          status: "error",
          message: "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.",
        });
      }

      // Cập nhật bổ sung thông tin Google nếu user cũ chưa có
      let updated = false;
      if (!user.googleId) {
        user.googleId = googleId;
        updated = true;
      }
      if (!user.avatar && picture) {
        user.avatar = picture;
        updated = true;
      }
      if (updated) await user.save();

      // Sử dụng generateToken của hệ thống để payload chứa '{ userId }'
      const jwtToken = generateToken(user._id);

      return res.json({
        status: "success",
        message: 'Đăng nhập Google thành công',
        token: jwtToken,
        user: formatUserResponse(user),
      });
    } else {
      // User mới
      const fullName = name || email.split('@')[0];

      // Lưu ý: enum role chỉ cho phép: "ADMIN", "learner", "INSTRUCTOR", "CONSULTANT"
      const newUser = new User({
        fullName,
        email,
        googleId,
        avatar: picture || null,
        role: 'learner',
        status: 'ACTIVE',
      });

      await newUser.save();

      const jwtToken = generateToken(newUser._id);

      return res.status(201).json({
        status: "success",
        message: 'Đăng ký bằng Google thành công',
        token: jwtToken,
        user: formatUserResponse(newUser),
      });
    }

  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(500).json({ status: "error", message: 'Lỗi xác thực Google' });
  }
};
// Login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        status: "error",
        message: "Email và mật khẩu là bắt buộc",
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    if (user.status === "INACTIVE") {
      return res.status(403).json({
        status: "error",
        message: "Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.",
      });
    }

    // Check password
    // If user doesn't have password (existing users), allow login with any password for now
    // In production, you should require password reset
    if (user.password) {
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          status: "error",
          message: "Email hoặc mật khẩu không đúng",
        });
      }
    }

    // Generate token
    const token = generateToken(user._id);
    console.log("✅ Token generated for user:", user.email);
    console.log("✅ JWT_SECRET:", JWT_SECRET ? "Set" : "Not set");

    // Return user and token
    res.json({
      status: "success",
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Register
export const register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({
        status: "error",
        message: "Vui lòng điền đầy đủ thông tin",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "Email đã được sử dụng",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user with USER role by default
    const user = new User({
      fullName: name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: "USER",
      status: "ACTIVE",
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Return user and token
    res.status(201).json({
      status: "success",
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Register error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        status: "error",
        message: "Email đã được sử dụng",
      });
    }
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Get current user profile
export const getProfile = async (req, res) => {
  try {
    const userId = req.userId || req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    res.json({
      status: "success",
      data: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Update profile
export const updateProfile = async (req, res) => {
  try {
    const userId = req.userId || req.params.id;
    const { name, email, phone, address, dateOfBirth, gender, avatar } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Update fields
    if (name) user.fullName = name;
    if (email) user.email = email.toLowerCase();
    if (phone) user.phone = phone;
    if (address !== undefined) user.address = address;
    if (dateOfBirth !== undefined) user.dateOfBirth = dateOfBirth;
    if (gender !== undefined) user.gender = gender;
    if (avatar !== undefined) user.avatar = avatar;

    await user.save();

    res.json({
      status: "success",
      data: formatUserResponse(user),
    });
  } catch (error) {
    console.error("Update profile error:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        status: "error",
        message: "Email đã được sử dụng",
      });
    }
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Forgot password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        status: "error",
        message: "Email là bắt buộc",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal if email exists for security - always return success
    if (!user) {
      return res.json({
        status: "success",
        message:
          "Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi mật khẩu mới đến email của bạn.",
      });
    }

    // Generate random 8-character password (UPPERCASE for clarity)
    const newPassword = crypto.randomBytes(4).toString("hex").toUpperCase();
    
    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    try {
      // Send the new password via email
      await sendPasswordResetEmail(user.email, newPassword);

      res.json({
        status: "success",
        message:
          "Chúng tôi đã cấp lại mật khẩu mới và gửi đến email của bạn. Vui lòng kiểm tra hộp thư.",
      });
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      res.status(500).json({
        status: "error",
        message: "Không thể gửi email. Vui lòng thử lại sau.",
      });
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      status: "error",
      message: "Có lỗi xảy ra. Vui lòng thử lại sau.",
    });
  }
};

// Logout
export const logout = async (req, res) => {
  try {
    // In a stateless JWT setup, the client simply deletes the token.
    // If we were using cookies, we would clear the cookie here.
    // We can also blacklist the token in Redis if we want to be strict.
    // For now, simple success response is enough for the client to proceed clearing local storage.

    res.json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};
