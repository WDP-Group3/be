import Feedback from '../models/Feedback.js';
import User from '../models/User.js';

// Get all feedbacks (Admin/Instructor view)
export const getFeedbacks = async (req, res) => {
    try {
        const { instructorId, minRating } = req.query;
        const filter = {};

        if (instructorId) filter.instructorId = instructorId;
        if (minRating) filter.rating = { $lte: parseInt(minRating) }; // "Low ratings" logic usually means <= threshold

        const feedbacks = await Feedback.find(filter)
            .populate('learnerId', 'fullName email') // Hide if anonymous in future
            .populate('instructorId', 'fullName')
            .sort({ createdAt: -1 });

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
        const { instructorId, rating, comment } = req.body;
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
            comment
        });

        await newFeedback.save();

        res.status(201).json({
            status: 'success',
            data: newFeedback,
            message: 'Feedback submitted successfully'
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};
