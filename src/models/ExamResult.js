import mongoose from 'mongoose';

const examResultSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  questions: [{
    questionNumber: {
      type: Number,
      required: true,
    },
    selectedAnswer: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
  }],
  totalQuestions: {
    type: Number,
    required: true,
    default: 35,
  },
  correctAnswers: {
    type: Number,
    required: true,
    default: 0,
  },
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  wrongQuestionNumbers: {
    type: [Number],
    default: [],
  },
  duration: {
    type: Number, // Thời gian làm bài (giây)
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: false,
});

// Indexes
examResultSchema.index({ studentId: 1 });
examResultSchema.index({ createdAt: -1 });

const ExamResult = mongoose.model('ExamResult', examResultSchema);

export default ExamResult;

