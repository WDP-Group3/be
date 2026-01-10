import Booking from '../models/Booking.js';

// Lấy tất cả bookings
export const getAllBookings = async (req, res) => {
  try {
    const { studentId, instructorId, batchId, status, date } = req.query;
    const filter = {};
    
    if (studentId) filter.studentId = studentId;
    if (instructorId) filter.instructorId = instructorId;
    if (batchId) filter.batchId = batchId;
    if (status) filter.status = status;
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }
    
    const bookings = await Booking.find(filter)
      .populate('studentId', 'fullName phone')
      .populate('instructorId', 'fullName phone')
      .populate('batchId', 'startDate location')
      .sort({ date: 1, timeSlot: 1 });
    
    res.json({
      status: 'success',
      data: bookings,
      count: bookings.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy booking theo ID
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id)
      .populate('studentId')
      .populate('instructorId')
      .populate('batchId');
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found',
      });
    }
    
    res.json({
      status: 'success',
      data: booking,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

