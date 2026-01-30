import Leads from '../models/Leads.js';
import User from '../models/User.js';

export const createLead = async (req, res) => {
    try {
        const { name, phone, course } = req.body;
        const lead = new Leads({
            name,
            phone,
            course,
            timeToCall: new Date(),
            status: 'pending',
        });
        await lead.save();
        return res.status(201).json(lead);
    } catch (error) {
        console.error('Error creating lead:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}

export const getAllLeads = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Auth info from middleware
        const userId = req.userId;
        const user = await User.findById(userId);

        const query = {};

        // Phân quyền: Nếu là CONSULTANT thì chỉ lấy lead được gán cho mình
        if (user && user.role === 'CONSULTANT') {
            query.assignTo = userId;
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const [leads, total] = await Promise.all([
            Leads.find(query)
                .populate('course', 'name')
                .populate('assignTo', 'fullName email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Leads.countDocuments(query)
        ]);

        return res.status(200).json({
            data: leads,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching leads:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}

export const assignLead = async (req, res) => {
    try {
        const { leadId } = req.params;
        const { consultantId } = req.body;

        const lead = await Leads.findByIdAndUpdate(
            leadId,
            { assignTo: consultantId },
            { new: true }
        ).populate('assignTo', 'fullName email');

        if (!lead) {
            return res.status(404).json({ message: 'Lead not found' });
        }

        return res.status(200).json(lead);
    } catch (error) {
        console.error('Error assigning lead:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}