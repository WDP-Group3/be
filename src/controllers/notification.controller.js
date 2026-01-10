import Notification from '../models/Notification.js';

// Lấy tất cả notifications
export const getAllNotifications = async (req, res) => {
  try {
    const { userId, isRead } = req.query;
    const filter = {};
    
    if (userId) filter.userId = userId;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    
    const notifications = await Notification.find(filter)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 });
    
    res.json({
      status: 'success',
      data: notifications,
      count: notifications.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy notification theo ID
export const getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findById(id)
      .populate('userId', 'fullName email');
    
    if (!notification) {
      return res.status(404).json({
        status: 'error',
        message: 'Notification not found',
      });
    }
    
    res.json({
      status: 'success',
      data: notification,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

