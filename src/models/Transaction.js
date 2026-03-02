
import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    vnp_Amount: {
        type: String,
        required: true,
    },
    vnp_BankCode: {
        type: String,
    },
    vnp_BankTranNo: {
        type: String,
    },
    vnp_CardType: {
        type: String,
    },
    vnp_OrderInfo: {
        type: String,
    },
    vnp_PayDate: {
        type: String,
    },
    vnp_ResponseCode: {
        type: String,
    },
    vnp_TmnCode: {
        type: String,
    },
    vnp_TransactionNo: {
        type: String,
    },
    vnp_TransactionStatus: {
        type: String,
    },
    vnp_SecureHash: {
        type: String,
    },
    // Optional application specific fields
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'process'],
        default: 'process',
    }
}, {
    timestamps: true,
});

transactionSchema.pre('validate', function (next) {
    if (this.vnp_TxnRef && !this._id) {
        this._id = this.vnp_TxnRef;
    }
    next();
});

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
