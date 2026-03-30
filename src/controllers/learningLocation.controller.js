import LearningLocation from '../models/LearningLocation.js';
import User from '../models/User.js';
import mongoose from 'mongoose';

// Lấy danh sách địa điểm học (cho dropdown / Schedule)
export const getLocations = async (req, res) => {
  try {
    const locations = await LearningLocation.find().select('areaName yardName _id').lean();
    const names = locations.map((l) => l.areaName);
    res.json({ status: 'success', data: names, locations });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: List
export const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const list = await LearningLocation.find()
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await LearningLocation.countDocuments();

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

// CRUD: Get one
export const getById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await LearningLocation.findById(id)
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .lean();
    if (!doc) return res.status(404).json({ status: 'error', message: 'Địa điểm học không tồn tại' });
    res.json({ status: 'success', data: doc });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Create
export const create = async (req, res) => {
  try {
    const { areaName, yardName, googleMapAddress, instructors } = req.body;
    if (!areaName || !areaName.trim()) {
      return res.status(400).json({ status: 'error', message: 'Tên khu vực là bắt buộc' });
    }
    const normalized = {
      areaName: areaName.trim(),
      yardName: (yardName || '').trim(),
      googleMapAddress: (googleMapAddress || '').trim(),
      instructors: Array.isArray(instructors) 
        ? instructors.reduce((acc, curr) => {
            if (curr.instructorId && curr.courseId && !acc.find(i => String(i.instructorId) === String(curr.instructorId))) {
              acc.push(curr);
            }
            return acc;
          }, [])
        : [],
    };
    const doc = await LearningLocation.create(normalized);
    if (doc.instructors && doc.instructors.length > 0) {
      const instructorIds = doc.instructors.map((i) => i.instructorId);
      await LearningLocation.updateMany(
        { _id: { $ne: doc._id }, 'instructors.instructorId': { $in: instructorIds } },
        { $pull: { instructors: { instructorId: { $in: instructorIds } } } }
      );
      await User.updateMany(
        { _id: { $in: instructorIds } },
        { $set: { workingLocation: doc.areaName } }
      );
    }
    const populated = await LearningLocation.findById(doc._id)
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .lean();
    res.status(201).json({ status: 'success', data: populated });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Update (hỗ trợ cập nhật instructors)
export const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { areaName, yardName, googleMapAddress, instructors } = req.body;
    const doc = await LearningLocation.findById(id);
    if (!doc) return res.status(404).json({ status: 'error', message: 'Địa điểm học không tồn tại' });
    if (areaName != null) doc.areaName = areaName.trim();
    if (yardName != null) doc.yardName = (yardName || '').trim();
    if (googleMapAddress != null) doc.googleMapAddress = (googleMapAddress || '').trim();

    if (Array.isArray(instructors)) {
      const validInstructors = [];
      const seenInstIds = new Set();
      instructors.forEach((i) => {
        const instId = i.instructorId?._id || i.instructorId;
        const courseId = i.courseId?._id || i.courseId;
        if (instId && courseId) {
          const idStr = String(instId);
          if (!seenInstIds.has(idStr)) {
            seenInstIds.add(idStr);
            validInstructors.push({ instructorId: instId, courseId });
          }
        }
      });
      const newInstructorIds = validInstructors.map((i) => i.instructorId?.toString?.() || i.instructorId);
      const oldInstructorIds = (doc.instructors || []).map((i) => i.instructorId?.toString?.() || i.instructorId);
      const removedIds = oldInstructorIds.filter((id) => !newInstructorIds.includes(id));

      // Gỡ thầy khỏi địa điểm khác nếu thầy chuyển sang đây
      if (newInstructorIds.length > 0) {
        await LearningLocation.updateMany(
          { _id: { $ne: id }, 'instructors.instructorId': { $in: newInstructorIds } },
          { $pull: { instructors: { instructorId: { $in: newInstructorIds } } } }
        );
        await User.updateMany(
          { _id: { $in: newInstructorIds } },
          { $set: { workingLocation: doc.areaName } }
        );
      }

      // Cập nhật workingLocation cho thầy bị gỡ (nếu còn ở nơi khác thì giữ, không thì null)
      for (const rid of removedIds) {
        const stillElsewhere = await LearningLocation.findOne({
          _id: { $ne: id },
          'instructors.instructorId': rid,
        }).select('areaName').lean();
        await User.findByIdAndUpdate(rid, {
          workingLocation: stillElsewhere ? stillElsewhere.areaName : null,
        });
      }

      doc.instructors = validInstructors;
    }

    await doc.save();
    const populated = await LearningLocation.findById(doc._id)
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .lean();
    res.json({ status: 'success', data: populated });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// CRUD: Delete
export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await LearningLocation.findById(id);
    if (!doc) return res.status(404).json({ status: 'error', message: 'Địa điểm học không tồn tại' });
    const instructorIds = doc.instructors.map((i) => i.instructorId);
    await doc.deleteOne();
    await User.updateMany(
      { _id: { $in: instructorIds } },
      { $set: { workingLocation: null } }
    );
    res.json({ status: 'success', message: 'Đã xóa địa điểm học' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Thêm thầy vào địa điểm (1 khu vực + 1 hạng dạy). Nếu thầy đã ở khu vực khác -> trả về needConfirm; nếu client gửi confirmMove thì chuyển thầy sang đây.
export const addInstructor = async (req, res) => {
  try {
    const learningLocationId = req.params.id;
    const { instructorId, courseId, confirmMove } = req.body;
    if (!instructorId || !courseId) {
      return res.status(400).json({
        status: 'error',
        message: 'Thiếu instructorId hoặc courseId',
      });
    }
    const loc = await LearningLocation.findById(learningLocationId);
    if (!loc) return res.status(404).json({ status: 'error', message: 'Địa điểm học không tồn tại' });

    const instructorObjId = mongoose.Types.ObjectId.isValid(instructorId) ? new mongoose.Types.ObjectId(instructorId) : null;
    const courseObjId = mongoose.Types.ObjectId.isValid(courseId) ? new mongoose.Types.ObjectId(courseId) : null;
    if (!instructorObjId || !courseObjId) {
      return res.status(400).json({ status: 'error', message: 'instructorId hoặc courseId không hợp lệ' });
    }

    const alreadyHere = loc.instructors.some(
      (i) => i.instructorId.toString() === instructorId && i.courseId.toString() === courseId
    );
    if (alreadyHere) {
      return res.status(400).json({ status: 'error', message: 'Thầy đã được gán khóa này tại địa điểm này' });
    }

    const otherLocation = await LearningLocation.findOne({
      _id: { $ne: learningLocationId },
      'instructors.instructorId': instructorObjId,
    }).select('areaName instructors').lean();

    if (otherLocation && !confirmMove) {
      return res.json({
        status: 'success',
        needConfirm: true,
        message: 'Thầy đang ở khu vực khác',
        currentLocationName: otherLocation.areaName,
      });
    }

    if (otherLocation && confirmMove) {
      await LearningLocation.updateOne(
        { _id: otherLocation._id },
        { $pull: { instructors: { instructorId: instructorObjId } } }
      );
    }

    loc.instructors = loc.instructors.filter((i) => i.instructorId.toString() !== instructorId);
    loc.instructors.push({ instructorId: instructorObjId, courseId: courseObjId });
    await loc.save();

    await User.findByIdAndUpdate(instructorObjId, {
      workingLocation: loc.areaName,
    });

    const populated = await LearningLocation.findById(loc._id)
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .lean();
    res.json({ status: 'success', data: populated, needConfirm: false });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

// Gỡ thầy khỏi địa điểm
export const removeInstructor = async (req, res) => {
  try {
    const { id, instructorId } = req.params;
    if (!instructorId) return res.status(400).json({ status: 'error', message: 'Thiếu instructorId' });
    const loc = await LearningLocation.findById(id);
    if (!loc) return res.status(404).json({ status: 'error', message: 'Địa điểm học không tồn tại' });
    const instructorObjId = mongoose.Types.ObjectId.isValid(instructorId) ? new mongoose.Types.ObjectId(instructorId) : null;
    if (!instructorObjId) return res.status(400).json({ status: 'error', message: 'instructorId không hợp lệ' });

    loc.instructors = loc.instructors.filter((i) => i.instructorId.toString() !== instructorId);
    await loc.save();

    const stillElsewhere = await LearningLocation.findOne({ 'instructors.instructorId': instructorObjId }).select('areaName').lean();
    await User.findByIdAndUpdate(instructorObjId, {
      workingLocation: stillElsewhere ? stillElsewhere.areaName : null,
    });

    const populated = await LearningLocation.findById(loc._id)
      .populate('instructors.instructorId', 'fullName email phone')
      .populate('instructors.courseId', 'code name')
      .lean();
    res.json({ status: 'success', data: populated });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
