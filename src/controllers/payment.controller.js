import Payment from '../models/Payment.js';

// Lấy tất cả payments
export const getAllPayments = async (req, res) => {
  try {
    const { registrationId, method } = req.query;
    const filter = {};
    
    if (registrationId) filter.registrationId = registrationId;
    if (method) filter.method = method;
    
    const payments = await Payment.find(filter)
      .populate('registrationId', 'studentId batchId status')
      .sort({ paidAt: -1 });
    
    res.json({
      status: 'success',
      data: payments,
      count: payments.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy payment theo ID
export const getPaymentById = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await Payment.findById(id)
      .populate('registrationId');
    
    if (!payment) {
      return res.status(404).json({
        status: 'error',
        message: 'Payment not found',
      });
    }
    
    res.json({
      status: 'success',
      data: payment,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

