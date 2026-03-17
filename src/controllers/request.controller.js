import Request from '../models/Request.js';
import User from '../models/User.js';
import Registration from '../models/Registration.js';

// Create a new request
export const createRequest = async (req, res) => {
    try {
        const { type, reason, expectedPayDate, paymentBatch, batchCourse, registrationId, metadata } = req.body;
        const userId = req.userId;

        if (!type || !reason) {
            return res.status(400).json({ status: 'error', message: 'Loại đơn và lý do không được để trống' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy người dùng' });
        }

        // Validate specific fields for LATE_PAYMENT
        if (type === 'LATE_PAYMENT') {
            if (!expectedPayDate) {
                return res.status(400).json({ status: 'error', message: 'Thời gian nộp không được để trống đối với đơn xin nộp muộn' });
            }
            if (user.role !== 'learner' && user.role !== 'ADMIN') {
                return res.status(403).json({ status: 'error', message: 'Chỉ học viên mới có quyền tạo đơn xin nộp muộn' });
            }
        }

        const newRequest = new Request({
            user: userId,
            type,
            reason,
            // LATE_PAYMENT fields
            expectedPayDate,
            paymentBatch,
            batchCourse,
            registrationId,
            status: user.role === 'ADMIN' ? 'APPROVED' : 'PENDING',
            metadata
        });

        await newRequest.save();

        // Admin auto-approve logic
        if (newRequest.status === 'APPROVED' && newRequest.type === 'LATE_PAYMENT' && newRequest.registrationId) {
            const reg = await Registration.findById(newRequest.registrationId);
            if (reg && reg.feePlanSnapshot) {
                const index = reg.feePlanSnapshot.findIndex(f => f.name === newRequest.paymentBatch);
                if (index !== -1) {
                    reg.feePlanSnapshot[index].dueDate = newRequest.expectedPayDate;
                    reg.feePlanSnapshot[index].note = `${reg.feePlanSnapshot[index].note || ''} | Gia hạn nộp muộn: ${newRequest.reason}`.trim();
                    reg.markModified('feePlanSnapshot');
                    await reg.save();
                }
            }
        }

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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const filter = {};
        if (type) filter.type = type;
        if (status) filter.status = status;

        const requests = await Request.find(filter)
            .populate('user', 'fullName email phone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Request.countDocuments(filter);

        res.json({
            status: 'success',
            data: requests,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
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

        // Check current status
        const requestToUpdate = await Request.findById(id);
        if (!requestToUpdate) {
            return res.status(404).json({ status: 'error', message: 'Không tìm thấy yêu cầu' });
        }

        const request = await Request.findByIdAndUpdate(
            id,
            { status },
            { new: true }
        );

        if (status === 'APPROVED' && request.type === 'LATE_PAYMENT' && request.registrationId && requestToUpdate.status !== 'APPROVED') {
            const reg = await Registration.findById(request.registrationId);
            if (reg && reg.feePlanSnapshot) {
                const index = reg.feePlanSnapshot.findIndex(f => f.name === request.paymentBatch);
                if (index !== -1) {
                    reg.feePlanSnapshot[index].dueDate = request.expectedPayDate;
                    reg.feePlanSnapshot[index].note = `${reg.feePlanSnapshot[index].note || ''} | Gia hạn nộp muộn: ${request.reason}`.trim();
                    reg.markModified('feePlanSnapshot');
                    await reg.save();
                }
            }
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

