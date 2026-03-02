import Request from '../models/Request.js';
import User from '../models/User.js';

// Create a new request
export const createRequest = async (req, res) => {
    try {
        const { type, reason, expectedPayDate, paymentDate, studentName, courseName, metadata } = req.body;
        const userId = req.userId;

        if (!type || !reason) {
            return res.status(400).json({ status: 'error', message: 'Loại đơn và lý do không được để trống' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
        }

        // Validate specific fields for LATE_PAYMENT
        if (type === 'LATE_PAYMENT' && !expectedPayDate) {
            return res.status(400).json({ status: 'error', message: 'Thời gian nộp không được để trống đối với đơn xin nộp muộn' });
        }

        // Validate specific fields and role for OFFLINE_PAYMENT
        if (type === 'OFFLINE_PAYMENT') {
            if (user.role !== 'CONSULTANT' && user.role !== 'ADMIN') {
                return res.status(403).json({ status: 'error', message: 'Chỉ tư vấn viên hoặc admin mới có quyền tạo đơn xác nhận nộp tiền offline' });
            }

            if (!paymentDate || !studentName || !courseName) {
                return res.status(400).json({ status: 'error', message: 'Vui lòng điền đầy đủ thông tin: ngày nộp, học viên và khóa học' });
            }
        }

        const newRequest = new Request({
            user: userId,
            type,
            reason,
            expectedPayDate,
            paymentDate,
            studentName,
            courseName,
            status: user.role === 'ADMIN' ? 'APPROVED' : 'PENDING',
            metadata
        });

        await newRequest.save();

        res.status(201).json({
            status: 'success',
            data: newRequest,
            message: 'Gửi yêu cầu thành công',
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Get all requests (for admin)
export const getAllRequests = async (req, res) => {
    try {
        const { type, status } = req.query;
        const filter = {};
        if (type) filter.type = type;
        if (status) filter.status = status;

        const requests = await Request.find(filter)
            .populate('user', 'fullName email phone')
            .sort({ createdAt: -1 });

        res.json({
            status: 'success',
            data: requests,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Get my requests (for user)
export const getMyRequests = async (req, res) => {
    try {
        const userId = req.userId;
        const { type } = req.query;
        const filter = { user: userId };
        if (type) filter.type = type;

        const requests = await Request.find(filter).sort({ createdAt: -1 });

        res.json({
            status: 'success',
            data: requests,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// Update request status (for admin)
export const updateRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // APPROVED or REJECTED

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Trạng thái không hợp lệ' });
        }

        const request = await Request.findByIdAndUpdate(
            id,
            { status },
            { new: true }
        );

        if (!request) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy yêu cầu' });
        }

        res.json({
            status: 'success',
            data: request,
            message: `Đã cập nhật trạng thái thành ${status}`,
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
