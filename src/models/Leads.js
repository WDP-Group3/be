import mongoose from 'mongoose';

const leadsSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
    },
    timeToCall: {
        type: Date,
        default: Date.now,
    },
    status: {
        type: String,
        enum: ['pending', 'contacted', 'cancelled'],
        default: 'pending',
    },
    assignTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: false,
});


const Leads = mongoose.model('Leads', leadsSchema);

export default Leads;

