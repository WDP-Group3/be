import mongoose from 'mongoose';

const requestSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        type: {
            type: String,
            enum: ['LATE_PAYMENT', 'SUPPORT', 'OTHER', 'OFFLINE_PAYMENT', 'CANCEL_SESSION'],
            default: 'LATE_PAYMENT',
            required: true,
        },
        reason: {
            type: String,
            required: true,
            trim: true,
        },
        expectedPayDate: {
            type: Date,
            // Only required for LATE_PAYMENT type
            required: function () {
                return this.type === 'LATE_PAYMENT';
            },
        },
        // Extra fields for LATE_PAYMENT (student)
        paymentBatch: {
            type: String,
            trim: true,
        },
        batchCourse: {
            type: String,
            trim: true,
        },
        // Fields for OFFLINE_PAYMENT
        paymentDate: {
            type: Date,
            required: function () {
                return this.type === 'OFFLINE_PAYMENT';
            },
        },
        LEARNERName: {
            type: String,
            trim: true,
            required: function () {
                return this.type === 'OFFLINE_PAYMENT';
            },
        },
        courseName: {
            type: String,
            trim: true,
            required: function () {
                return this.type === 'OFFLINE_PAYMENT';
            },
        },
        // Fields for CANCEL_SESSION (instructor)
        sessionInfo: {
            type: String,
            trim: true,
            required: function () {
                return this.type === 'CANCEL_SESSION';
            },
        },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'REJECTED'],
            default: 'PENDING',
        },
        // For extensibility
        metadata: {
            type: mongoose.Schema.Types.Mixed,
        }
    },
    {
        timestamps: true,
    }
);

const Request = mongoose.model('Request', requestSchema);

export default Request;
