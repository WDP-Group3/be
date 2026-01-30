
import dotenv from 'dotenv';
import { VNPay, ignoreLogger, ProductCode, VnpLocale, dateFormat } from 'vnpay';
import Transaction from '../models/Transaction.js';
import mongoose from 'mongoose';

dotenv.config();

const TMN_CODE = process.env.TMN_CODE || '2VBV7V3L6TA36WY82C996VTKIYHK9NVS';
const SERCURE_SECRET = process.env.SERCURE_SECRET || 'http://localhost:3000/api';
const RETURN_URL = process.env.RETURN_URL || '';
const URL_FE = process.env.URL_FE || 'http://localhost:5173';

export const createQR = async (req, res) => {
    try {
        const { vnp_Amount, vnp_OrderInfo, user } = req.body;

        const vnpay = new VNPay({
            tmnCode: TMN_CODE,
            secureSecret: SERCURE_SECRET,
            vnpayHost: 'https://sandbox.vnpayment.vn',
            testMode: true,
            hashAlgorithm: 'SHA512',
            loggerFn: ignoreLogger,
        });


        // Create a pending transaction record
        const transaction = new Transaction({
            vnp_Amount: vnp_Amount.toString(),
            status: 'pending',
            user: user,
        });

        await transaction.save();

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const vnpayResponse = await vnpay.buildPaymentUrl({
            vnp_Amount: vnp_Amount,
            vnp_IpAddr: '127.0.0.1',
            vnp_TxnRef: transaction._id,
            vnp_OrderInfo: vnp_OrderInfo,
            vnp_OrderType: ProductCode.Other,
            vnp_ReturnUrl: RETURN_URL,
            vnp_Locale: VnpLocale.VN,
            vnp_CreateDate: dateFormat(new Date()),
            vnp_ExpireDate: dateFormat(tomorrow),
        });

        return res.status(201).json(vnpayResponse)
    } catch (error) {
        console.error('Error creating QR:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}
export const checkStatus = async (req, res) => {
    try {
        const { vnp_TxnRef, ...updateData } = req.query;
        const transaction = await Transaction.findByIdAndUpdate(vnp_TxnRef, {
            ...updateData,
            status: 'completed'
        }, { new: true });
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        res.redirect(URL_FE);
    } catch (error) {
        console.error('Error checking status:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}
