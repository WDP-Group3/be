import ExamLocation from '../models/ExamLocation.js';

// CRUD: List
export const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const list = await ExamLocation.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await ExamLocation.countDocuments();

    res.json({
      status: 'success',
      data: list,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Lấy danh sách đơn giản cho dropdown
export const getAllSimple = async (req, res) => {
  try {
    const list = await ExamLocation.find().select('name address googleMapUrl _id').sort({ name: 1 }).lean();
    res.json({ status: 'success', data: list });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Get one
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await ExamLocation.findById(id).lean();
    if (!doc) return res.status(404).json({ status: 'error', message: 'Sân sát hạch không tồn tại' });
    res.json({ status: 'success', data: doc });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Create
export const create = async (req, res) => {
  try {
    const { name, address, googleMapUrl, image } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ status: 'error', message: 'Tên trường thi sát hạch là bắt buộc' });
    }
    const doc = await ExamLocation.create({
      name: name.trim(),
      address: (address || '').trim(),
      googleMapUrl: (googleMapUrl || '').trim(),
      image: (image || '').trim(),
    });
    res.status(201).json({ status: 'success', data: doc });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Update
export const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, googleMapUrl, image } = req.body;
    const doc = await ExamLocation.findById(id);
    if (!doc) return res.status(404).json({ status: 'error', message: 'Sân sát hạch không tồn tại' });
    if (name != null) doc.name = name.trim();
    if (address != null) doc.address = (address || '').trim();
    if (googleMapUrl != null) doc.googleMapUrl = (googleMapUrl || '').trim();
    if (image != null) doc.image = (image || '').trim();
    await doc.save();
    res.json({ status: 'success', data: doc });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Delete
export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await ExamLocation.findById(id);
    if (!doc) return res.status(404).json({ status: 'error', message: 'Sân sát hạch không tồn tại' });
    await doc.deleteOne();
    res.json({ status: 'success', message: 'Đã xóa sân sát hạch' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};