import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { sendNotificationMailToRoles } from "../services/email.service.js";
import {
  TYPE_TITLES_Notification,
  targetRoles,
} from "../constants/constant.js";
// Lấy tất cả notifications
export const getAllNotifications = async (req, res) => {
  try {
    const { type, search } = req.query;
    const filter = {};

    // Filter by Type
    if (type) {
      filter.type = type;
    }

    // Search by Title
    if (search) {
      filter.title = { $regex: search, $options: "i" };
    }

    const notifications = await Notification.find(filter).sort({
      createdAt: -1,
    });

    res.json({
      status: "success",
      data: notifications,
      count: notifications.length,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Lấy notification theo ID
export const getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findById(id);

    if (!notification) {
      return res.status(404).json({
        status: "error",
        message: "Notification not found",
      });
    }

    res.json({
      status: "success",
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Tạo notification mới
export const createNotification = async (req, res) => {
  try {
    const { type, message, expirationDays } = req.body;
    let { title } = req.body;

    // Validate inputs
    if (!type || !message || !expirationDays) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: type, message, expirationDays",
      });
    }

    // Determine Title
    if (type === "OTHER") {
      if (!title) {
        return res.status(400).json({
          status: "error",
          message: "Title is required for OTHER type",
        });
      }
    } else {
      // Use predefined title for standard types
      title = TYPE_TITLES_Notification[type] || "Thông báo";
    }

    // Calculate Expiration
    const days = parseInt(expirationDays);
    if (isNaN(days) || days <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Expiration days must be a positive number",
      });
    }
    const expireAt = new Date();
    expireAt.setDate(expireAt.getDate() + days);

    const newNotification = new Notification({
      userId: null, // Broadcast to all by default for this feature
      type,
      title,
      message,
      expireAt,
      isRead: false,
    });

    await newNotification.save();

    sendNotificationMailToRoles({
      roles: targetRoles,
      title: newNotification.title,
      message: newNotification.message,
    });

    res.status(201).json({
      status: "success",
      data: newNotification,
      message: "Notification created successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Update Notification (Admin only)
export const updateNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, message, expirationDays } = req.body;
    let { title } = req.body;

    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({
        status: "error",
        message: "Notification not found",
      });
    }

    // Logic for title update similar to create
    if (type) {
      if (type === "OTHER") {
        // If switching to OTHER, title is required if not existing
        if (!title && notification.type !== "OTHER") {
          // If client didn't send title, we might want to error,
          // or keep old title? Let's require it if it's changing logic.
          // But simple logic: if title provided, use it. If not, and type is OTHER, check if we have one?
          // Simplest: Just re-apply the logic.
          if (!title) title = notification.title; // Keep existing or require input?
        }
      } else {
        title = TYPE_TITLES_Notification[type];
      }
      notification.type = type;
    }

    if (title) notification.title = title;
    if (message) notification.message = message;

    if (expirationDays) {
      const days = parseInt(expirationDays);
      if (!isNaN(days) && days > 0) {
        const expireAt = new Date(notification.createdAt); // Should this be from Now or CreatedAt? "kể từ ngày tạo". User said "kể từ ngày tạo sau 30 nagyf".
        expireAt.setDate(expireAt.getDate() + days);
        notification.expireAt = expireAt;
      }
    }

    await notification.save();

    sendNotificationMailToRoles({
      roles: targetRoles,
      title: notification.title,
      message: notification.message,
    });

    res.json({
      status: "success",
      data: notification,
      message: "Notification updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Delete Notification (Admin only)
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Notification.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({
        status: "error",
        message: "Notification not found",
      });
    }

    res.json({
      status: "success",
      message: "Notification deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};
