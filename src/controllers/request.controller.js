import Request from '../models/Request.js';
import User from '../models/User.js';
import Registration from '../models/Registration.js';
import Schedule from '../models/Schedule.js';
import Booking from '../models/Booking.js';
import { sendNotificationEmail } from '../services/email.service.js';

// [HELPER] Tháng hiện tại "YYYY-MM"
const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// [HELPER] Tăng số lần nghỉ phép khẩn cấp; nếu đã >= 2 thì tăng thêm emergencyLeaveOverflowCount
const incrementEmergencyLeave = async (instructorId) => {
  const currentMonth = getCurrentMonth();
  const user = await User.findById(instructorId);
  if (!user) return;
  if (user.lastEmergencyLeaveMonth !== currentMonth) {
    user.emergencyLeaveCount = 1;
    user.lastEmergencyLeaveMonth = currentMonth;
  } else {
    user.emergencyLeaveCount += 1;
    if (user.emergencyLeaveCount > 2) {
      user.emergencyLeaveOverflowCount = (user.emergencyLeaveOverflowCount || 0) + 1;
    }
  }
  await user.save();
};

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

            // Check trùng lặp: không cho phép xin nộp muộn 2 lần cho cùng 1 đợt
            if (registrationId && paymentBatch) {
                const duplicate = await Request.findOne({
                    user: userId,
                    type: 'LATE_PAYMENT',
                    registrationId,
                    paymentBatch,
                    status: { $in: ['PENDING', 'APPROVED'] },
                });
                if (duplicate) {
                    return res.status(400).json({
                        status: 'error',
                        message: `Bạn đã có đơn xin nộp muộn cho đợt "${paymentBatch}" này rồi (trạng thái: ${duplicate.status === 'PENDING' ? 'Chờ duyệt' : 'Đã duyệt'}). Không thể gửi thêm đơn.`,
                    });
                }
            }

            // Validate expectedPayDate trong vòng 30 ngày từ dueDate của đợt
            if (registrationId && paymentBatch) {
                const reg = await Registration.findById(registrationId);
                if (reg && reg.feePlanSnapshot) {
                    const feePlan = reg.feePlanSnapshot.find(f => f.name === paymentBatch);
                    if (feePlan && feePlan.dueDate) {
                        const dueDate = new Date(feePlan.dueDate);
                        const maxAllowed = new Date(dueDate);
                        maxAllowed.setDate(maxAllowed.getDate() + 30);
                        const payDate = new Date(expectedPayDate);
                        if (payDate > maxAllowed) {
                            return res.status(400).json({
                                status: 'error',
                                message: `Ngày nộp dự kiến không được vượt quá 30 ngày kể từ hạn nộp (${dueDate.toLocaleDateString('vi-VN')}). Hạn tối đa: ${maxAllowed.toLocaleDateString('vi-VN')}.`,
                            });
                        }
                    }
                }
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

        // Xử lý khi duyệt đơn LATE_PAYMENT
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

        // [MỚI] Xử lý khi duyệt đơn INSTRUCTOR_BUSY (báo bận khẩn cấp)
        if (status === 'APPROVED' && request.type === 'INSTRUCTOR_BUSY' && requestToUpdate.status !== 'APPROVED') {
            const metadata = request.metadata || {};
            
            // 1. Tạo schedule bận
            if (metadata.date && metadata.timeSlot) {
                const startOfDay = new Date(metadata.date);
                startOfDay.setHours(0, 0, 0, 0);
                
                if (metadata.timeSlot === 'all') {
                    // Báo bận cả ngày - tạo tất cả các ca
                    const allSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                    for (const slot of allSlots) {
                        await Schedule.findOneAndUpdate(
                            {
                                instructorId: request.user,
                                date: startOfDay,
                                timeSlot: slot
                            },
                            {
                                instructorId: request.user,
                                date: startOfDay,
                                timeSlot: slot,
                                type: 'BUSY',
                                isEmergency: true,
                                note: `Báo bận khẩn cấp (admin duyệt): ${request.reason}`
                            },
                            { upsert: true, new: true }
                        );
                    }
                } else {
                    // Báo bận theo ca
                    await Schedule.findOneAndUpdate(
                        {
                            instructorId: request.user,
                            date: startOfDay,
                            timeSlot: Number(metadata.timeSlot)
                        },
                        {
                            instructorId: request.user,
                            date: startOfDay,
                            timeSlot: Number(metadata.timeSlot),
                            type: 'BUSY',
                            isEmergency: true,
                            note: `Báo bận khẩn cấp (admin duyệt): ${request.reason}`
                        },
                        { upsert: true, new: true }
                    );
                }
            }

            // 2. Huỷ booking nếu có action CANCEL_BOOKING
            if (metadata.action === 'CANCEL_BOOKING' && metadata.date) {
                const startOfDay = new Date(metadata.date);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(metadata.date);
                endOfDay.setHours(23, 59, 59, 999);

                let slotsToCancel = [];
                if (metadata.timeSlot === 'all') {
                    slotsToCancel = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
                } else {
                    slotsToCancel = [Number(metadata.timeSlot)];
                }

                const instructorInfo = await User.findById(request.user);

                for (const slot of slotsToCancel) {
                    const booking = await Booking.findOne({
                        instructorId: request.user,
                        date: { $gte: startOfDay, $lte: endOfDay },
                        timeSlot: String(slot),
                        status: { $nin: ['CANCELLED', 'REJECTED'] }
                    }).populate('learnerId', 'fullName email phone');

                    if (booking) {
                        booking.status = 'CANCELLED';
                        booking.instructorNote = `Huỷ do admin duyệt đơn báo bận khẩn cấp: ${request.reason}`;
                        await booking.save();

                        // Gửi email thông báo cho học viên
                        if (booking.learnerId?.email) {
                            await sendNotificationEmail(
                                booking.learnerId.email,
                                '🔔 Thông báo: Lịch học đã bị huỷ do giáo viên báo bận khẩn cấp (đã được duyệt)',
                                `Kính gửi Học viên ${booking.learnerId.fullName},

Lịch học của bạn đã bị huỷ do giáo viên báo bận khẩn cấp và đã được admin duyệt.

Thông tin lịch học bị huỷ:
- Ngày: ${new Date(metadata.date).toLocaleDateString('vi-VN')}
- Ca: ${slot}

Lý do: ${request.reason}

Vui lòng liên hệ giáo viên hoặc admin để đặt lịch học bù.

Trân trọng!`
                            );
                        }
                    }
                }
            }

            // 3. Tăng counter emergency leave cho giáo viên
            await incrementEmergencyLeave(request.user);

            // 4. Gửi email thông báo cho giáo viên
            const instructorInfo = await User.findById(request.user);
            if (instructorInfo?.email) {
                await sendNotificationEmail(
                    instructorInfo.email,
                    '✅ Thông báo: Đơn báo bận khẩn cấp đã được duyệt',
                    `Kính gửi Thầy/Cô ${instructorInfo.fullName},

Đơn báo bận khẩn cấp của Thầy/Cô đã được admin duyệt.

Thông tin đơn:
- Ngày báo bận: ${metadata.date ? new Date(metadata.date).toLocaleDateString('vi-VN') : 'N/A'}
- Ca: ${metadata.timeSlot === 'all' ? 'Cả ngày' : metadata.timeSlot}
- Lý do: ${request.reason}

${metadata.action === 'CANCEL_BOOKING' ? 'Các lịch học của học viên đã được huỷ và thông báo.' : ''}

Trân trọng!`
                );
            }
        }

        // [MỚI] Gửi email khi từ chối đơn INSTRUCTOR_BUSY
        if (status === 'REJECTED' && request.type === 'INSTRUCTOR_BUSY' && requestToUpdate.status !== 'REJECTED') {
            const metadata = request.metadata || {};
            const instructorInfo = await User.findById(request.user);
            
            if (instructorInfo?.email) {
                await sendNotificationEmail(
                    instructorInfo.email,
                    '❌ Thông báo: Đơn báo bận khẩn cấp đã bị từ chối',
                    `Kính gửi Thầy/Cô ${instructorInfo.fullName},

Rất tiếc, đơn báo bận khẩn cấp của Thầy/Cô đã bị từ chối.

Thông tin đơn:
- Ngày báo bận: ${metadata.date ? new Date(metadata.date).toLocaleDateString('vi-VN') : 'N/A'}
- Ca: ${metadata.timeSlot === 'all' ? 'Cả ngày' : metadata.timeSlot}
- Lý do từ chối: ${request.reason}

Vui lòng liên hệ admin để biết thêm chi tiết.

Trân trọng!`
                );
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

