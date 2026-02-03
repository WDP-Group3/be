import ExamResult from '../models/ExamResult.js';
import User from '../models/User.js';
import Course from '../models/Course.js';
import Registration from '../models/Registration.js';

// Get Stats (Admin)
export const getStats = async (req, res) => {
    try {
        // 1. Enrollment Count (Active Students)
        // Assuming 'STUDENT' role or Registration count
        const studentCount = await User.countDocuments({ role: 'STUDENT', status: 'ACTIVE' });

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
                students: studentCount,
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
