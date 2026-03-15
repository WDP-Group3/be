import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import Registration from '../models/Registration.js';
import Payment from '../models/Payment.js';
import Batch from '../models/Batch.js';

// ─── Helper ────────────────────────────────────────────────────────────────
const currentYear = () => new Date().getFullYear();

// Get Stats (Admin)
export const getStats = async (req, res) => {
    try {
        // 1. Enrollment Count (Active LEARNERs)
        // Assuming 'LEARNER' role or Registration count
        const LEARNERCount = await User.countDocuments({ role: 'LEARNER', status: 'ACTIVE' });

        // 2. Revenue (Sum of paid courses - mock logic via Course Price * Registrations)
        // Since we don't have a Payment Transaction model fully visible, we estimate via Registration * Course Price
        // Or just mock it if Registration is simple. Let's use Registration count for now.
        // Assuming Registration model exists (it was in the list), let's peek at it later if needed, but here is a safe bet:
        const registrationCount = await Registration.countDocuments({});
        const revenueEstimate = registrationCount * 5000000; // Mock average 5M VND

        // 3. Pass Rate (Exam Results)
        const passedExams = await ExamResult.countDocuments({ score: { $gte: 32 } }); // 32 is pass mark
        const totalExams = await ExamResult.countDocuments({});
        const passRate = totalExams > 0 ? ((passedExams / totalExams) * 100).toFixed(1) : 0;

        res.json({
            status: 'success',
            data: {
                LEARNERs: LEARNERCount,
                registration: registrationCount,
                revenue: revenueEstimate,
                passRate: parseFloat(passRate),
                totalExams
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 1. Doanh thu thực từng tháng ──────────────────────────────────────────
export const getRevenueByMonth = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        const rows = await Payment.aggregate([
            { $match: { paidAt: { $gte: start, $lt: end } } },
            {
                $group: {
                    _id: { $month: '$paidAt' },
                    revenue: { $sum: '$amount' },
                    count: { $sum: 1 },
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Fill all 12 months
        const months = Array.from({ length: 12 }, (_, i) => {
            const found = rows.find(r => r._id === i + 1);
            return { month: i + 1, revenue: found?.revenue || 0, count: found?.count || 0 };
        });

        res.json({ status: 'success', data: months });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 2. Số đăng ký mới từng tháng ──────────────────────────────────────────
export const getRegistrationStats = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        const rows = await Registration.aggregate([
            { $match: { createdAt: { $gte: start, $lt: end } } },
            {
                $group: {
                    _id: { $month: '$createdAt' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const months = Array.from({ length: 12 }, (_, i) => {
            const found = rows.find(r => r._id === i + 1);
            return { month: i + 1, count: found?.count || 0 };
        });

        res.json({ status: 'success', data: months });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 3. Phân bổ phương thức thanh toán ────────────────────────────────────
export const getPaymentMethodStats = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        const rows = await Payment.aggregate([
            { $match: { paidAt: { $gte: start, $lt: end } } },
            {
                $group: {
                    _id: '$method',
                    total: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const data = rows.map(r => ({
            method: r._id,
            total: r.total,
            count: r.count
        }));

        res.json({ status: 'success', data });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 4. Top 5 khóa học theo doanh thu ─────────────────────────────────────
export const getTopCourses = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        // Payment → Registration → Batch → Course
        const rows = await Payment.aggregate([
            { $match: { paidAt: { $gte: start, $lt: end } } },
            {
                $lookup: {
                    from: 'registrations',
                    localField: 'registrationId',
                    foreignField: '_id',
                    as: 'reg'
                }
            },
            { $unwind: '$reg' },
            {
                $lookup: {
                    from: 'batches',
                    localField: 'reg.batchId',
                    foreignField: '_id',
                    as: 'batch'
                }
            },
            { $unwind: '$batch' },
            {
                $lookup: {
                    from: 'courses',
                    localField: 'batch.courseId',
                    foreignField: '_id',
                    as: 'course'
                }
            },
            { $unwind: '$course' },
            {
                $group: {
                    _id: '$course._id',
                    name: { $first: '$course.name' },
                    code: { $first: '$course.code' },
                    revenue: { $sum: '$amount' },
                    LEARNERs: { $addToSet: '$reg.LEARNERId' }
                }
            },
            {
                $project: {
                    name: 1,
                    code: 1,
                    revenue: 1,
                    LEARNERCount: { $size: '$LEARNERs' }
                }
            },
            { $sort: { revenue: -1 } },
            { $limit: 5 }
        ]);

        res.json({ status: 'success', data: rows });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 5. Tóm tắt công nợ ────────────────────────────────────────────────────
export const getDebtSummary = async (req, res) => {
    try {
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        // Tổng phải thu = feePlanSnapshot của các đăng ký trong năm
        const regAgg = await Registration.aggregate([
            { $match: { createdAt: { $gte: start, $lt: end } } },
            { $unwind: '$feePlanSnapshot' },
            {
                $group: {
                    _id: null,
                    totalDue: { $sum: '$feePlanSnapshot.amount' }
                }
            }
        ]);
        const totalDue = regAgg[0]?.totalDue || 0;

        // Tổng đã thu = payments trong năm
        const payAgg = await Payment.aggregate([
            { $match: { paidAt: { $gte: start, $lt: end } } },
            { $group: { _id: null, totalPaid: { $sum: '$amount' } } }
        ]);
        const totalPaid = payAgg[0]?.totalPaid || 0;

        const totalDebt = Math.max(0, totalDue - totalPaid);

        res.json({
            status: 'success',
            data: { totalDue, totalPaid, totalDebt }
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};

// ─── 6. Giao dịch gần đây ──────────────────────────────────────────────────
export const getRecentTransactions = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const year = parseInt(req.query.year) || currentYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);

        const payments = await Payment.aggregate([
            { $match: { paidAt: { $gte: start, $lt: end } } },
            { $sort: { paidAt: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: 'registrations',
                    localField: 'registrationId',
                    foreignField: '_id',
                    as: 'reg'
                }
            },
            { $unwind: { path: '$reg', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'reg.LEARNERId',
                    foreignField: '_id',
                    as: 'LEARNER'
                }
            },
            { $unwind: { path: '$LEARNER', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'batches',
                    localField: 'reg.batchId',
                    foreignField: '_id',
                    as: 'batch'
                }
            },
            { $unwind: { path: '$batch', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'courses',
                    localField: 'batch.courseId',
                    foreignField: '_id',
                    as: 'course'
                }
            },
            { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    amount: 1,
                    method: 1,
                    paidAt: 1,
                    note: 1,
                    LEARNERName: { $concat: ['$LEARNER.firstName', ' ', '$LEARNER.lastName'] },
                    LEARNEREmail: '$LEARNER.email',
                    courseName: '$course.name',
                    courseCode: '$course.code',
                }
            }
        ]);

        res.json({ status: 'success', data: payments });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
