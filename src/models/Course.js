import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true, // Mã khóa học nên là duy nhất
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  estimatedDuration: {
    type: String, // Sửa thành String để lưu được "3 tháng" như trong ảnh
  },
  estimatedCost: {
    type: Number, // Tương ứng với price trong controller
  },
  image: {
    type: String, // Thêm trường này vì controller có gửi lên
  },
  location: {
    type: [String],
    default: [],
  },
  note: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active',
  },
}, {
  timestamps: true, // Nên để true để có createdAt/updatedAt
});

// Indexes
courseSchema.index({ code: 1 });
courseSchema.index({ name: 'text', code: 'text' }); // Index tìm kiếm text

const Course = mongoose.model('Course', courseSchema);

export default Course;