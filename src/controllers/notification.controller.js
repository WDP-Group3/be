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


// Tạo notification mới
export const createNotification = async (req, res) => {
  try {
    const { title, message, recipientType, recipientId, group } = req.body;

    // Validate inputs
    if (!title || !message || !recipientType) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields',
      });
    }

    // Logic xử lý gửi cho Group hoặc Individual
    // Ở đây ta đơn giản hoá lưu vào DB, có thể mở rộng gửi Push Notif/Email

    // Nếu gửi cho group, ta có thể tạo record cho từng user hoặc tạo 1 record chung
    // Để đơn giản cho demo, ta tạo 1 record chung nếu là broadcast/group, 
    // hoặc tạo cụ thể nếu có recipientId.

    const newNotification = new Notification({
      title,
      message,
      // Nếu là group thì recipientId có thể null hoặc đại diện cho group
      // Trong mô hình Notification hiện tại chưa thấy schema, nhưng giả sử có userId
      userId: recipientId || null,
      isRead: false,
      // Lưu thêm metadata nếu schema hỗ trợ
      // recipientType: recipientType 
    });

    await newNotification.save();

    res.status(201).json({
      status: 'success',
      data: newNotification,
      message: 'Notification created successfully'
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};
