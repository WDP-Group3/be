import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../services/email.service.js";

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
    const { name, email, phone, password, role = "STUDENT" } = req.body;

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

    // Determine initial role and approval status
    let initialRole = "GUEST";
    let approvalStatus = "PENDING";
    let requestedRole = role;

    // Special case for ADMIN (if we allow creating admin via this API, which we shouldn't publicly)
    // But IF we did, we'd check here. For now, everyone becomes GUEST.
    if (role === "ADMIN") {
      // Decide policy: either forbid or allow. 
      // Assuming public register -> NO ADMIN allowed. 
      // If seeded/internal, they use different flow.
      // Let's force GUEST even if they ask for ADMIN, or error out.
      // For safety: 
      requestedRole = "STUDENT"; // Fallback or Error
    }

    // Create new user
    const user = new User({
      fullName: name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: initialRole,
      requestedRole: requestedRole,
      approvalStatus: approvalStatus,
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
    const { name, email, phone, address, dateOfBirth, gender } = req.body;

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
          "Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi link đặt lại mật khẩu đến email của bạn.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpires = new Date();
    resetTokenExpires.setHours(resetTokenExpires.getHours() + 1); // Token expires in 1 hour

    // Save reset token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpires;
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${resetToken}`;

    try {
      // Send password reset email
      await sendPasswordResetEmail(user.email, resetToken, resetUrl);

      res.json({
        status: "success",
        message:
          "Chúng tôi đã gửi link đặt lại mật khẩu đến email của bạn. Vui lòng kiểm tra hộp thư.",
      });
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      // Even if email fails, don't reveal to user
      // In production, you might want to log this for admin
      res.json({
        status: "success",
        message:
          "Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi link đặt lại mật khẩu đến email của bạn.",
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
