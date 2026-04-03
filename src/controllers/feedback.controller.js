import Feedback from '../models/Feedback.js';
import User from '../models/User.js';
import { sendNotificationEmail } from '../services/email.service.js';

// Get all feedbacks (Admin/Instructor view)
export const getFeedbacks = async (req, res) => {
    try {
        const { instructorId, minRating, type, status, startDate, endDate, learnerId } = req.query;
        const filter = {};

        if (instructorId) filter.instructorId = instructorId;
        if (learnerId) filter.learnerId = learnerId; // Cho phép học viên tải ds feedback của họ nếu cần
        if (minRating) filter.rating = { $lte: parseInt(minRating) };
        if (type) filter.type = type;
        if (status) filter.status = status;
        if (startDate && endDate) filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };

        const feedbacks = await Feedback.find(filter)
            .populate('learnerId', 'fullName email') // Hide if anonymous in future
            .populate('instructorId', 'fullName')
            .sort({ updatedAt: -1, createdAt: -1 });

        res.json({
            status: 'success',
            data: feedbacks,
            count: feedbacks.length,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Create feedback (Learner)
export const createFeedback = async (req, res) => {
    try {
        const { instructorId, rating, comment, type } = req.body;
        // Assume req.userId comes from auth middleware
        const learnerId = req.userId;

        // Basic validation
        if (!instructorId || !rating) {
            return res.status(400).json({ status: 'error', message: 'Instructor and Rating are required' });
        }

        const newFeedback = new Feedback({
            learnerId,
            instructorId,
            rating,
            comment,
            type: type || 'NORMAL'
        });

        await newFeedback.save();

        if (newFeedback.type === 'COMPLAINT') {
           const adminUsers = await User.find({ role: 'ADMIN' });
           for (const admin of adminUsers) {
               if (admin.email) {
                   await sendNotificationEmail(
                       admin.email, 
                       '⚠️ Có 1 Đơn khiếu nại mới từ học viên', 
                       `Hệ thống vừa nhận được 1 đơn khiếu nại (đánh giá ${rating} sao).\nNội dung: ${comment || 'Không có bình luận'}\nVui lòng kiểm tra màn hình Quản lý Đánh Giá.`
                   ).catch(() => {});
               }
           }
        }

        res.status(201).json({
            status: 'success',
            data: newFeedback,
            message: 'Feedback submitted successfully'
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Edit feedback (Learner)
export const updateFeedback = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, comment, type } = req.body;
        const learnerId = req.userId;

        const feedback = await Feedback.findOne({ _id: id, learnerId });
        if (!feedback) {
            return res.status(404).json({ status: 'error', message: 'Feedback not found or unauthorized' });
        }

        const wasNormal = feedback.type === 'NORMAL';
        const isNowComplaint = type === 'COMPLAINT';

        if (rating !== undefined) feedback.rating = rating;
        if (comment !== undefined) feedback.comment = comment;
        if (type !== undefined) feedback.type = type;
        // Gắn lại UNREAD nếu có sửa đổi nội dung
        feedback.status = 'UNREAD'; 
        feedback.updatedAt = Date.now();

        await feedback.save();

        if (wasNormal && isNowComplaint) {
           const adminUsers = await User.find({ role: 'ADMIN' });
           for (const admin of adminUsers) {
               if (admin.email) {
                   await sendNotificationEmail(
                       admin.email, 
                       '⚠️ Học viên vừa cập nhật 1 đánh giá thành Đơn khiếu nại', 
                       `Hệ thống ghi nhận 1 đánh giá vừa đổi thành khiếu nại (${feedback.rating} sao).\nNội dung: ${feedback.comment || 'Không có bình luận'}\nVui lòng kiểm tra màn hình Quản lý Đánh Giá.`
                   ).catch(() => {});
               }
           }
        }

        res.json({ status: 'success', data: feedback });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Update status (Admin)
export const updateFeedbackStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['READ', 'UNREAD'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid status' });
        }

        const feedback = await Feedback.findByIdAndUpdate(id, { status }, { new: true });
        if (!feedback) return res.status(404).json({ status: 'error', message: 'Feedback not found' });

        res.json({ status: 'success', data: feedback });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
