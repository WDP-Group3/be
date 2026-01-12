import ExamResult from '../models/ExamResult.js';
import { getQuestionByNumber } from '../services/externalApi.js';

// Nộp bài và chấm điểm
export const submitExam = async (req, res) => {
  try {
    const { studentId, questions, duration, category } = req.body;

    if (!studentId || !questions || !Array.isArray(questions)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request data',
      });
    }

    // NEW LOGIC: Nhận kết quả đã tính toán từ Frontend
    // Chúng ta tin tưởng frontend đã tính toán đúng (hoặc backend chỉ đóng vai trò lưu trữ)

    // Nếu FE gửi lên chi tiết đã chấm điểm
    let examQuestions = [];
    let correctCount = 0;
    let wrongNumbers = [];
    let calculatedScore = 0;

    // Check if FE sent pre-calculated data
    if (req.body.score !== undefined && req.body.correctAnswers !== undefined) {
      // Use data from FE
      correctCount = req.body.correctAnswers;
      calculatedScore = req.body.score;
      wrongNumbers = req.body.wrongQuestionNumbers || [];

      examQuestions = questions.map(q => ({
        questionNumber: parseInt(q.questionId),
        selectedAnswer: q.selectedAnswer,
        isCorrect: q.isCorrect // FE should send this
      }));
    } else {
      // Fallback or validation logic? 
      // For now, let's keep the old logic as a fallback if needed OR just assume FE sends everything.
      // But user said "tính toán luôn trên fe", so let's assume FE sends the structure.

      // However, to be safe, let's just process the 'questions' array specific for saving
      // Assuming user sends: questions: [{ questionId, selectedAnswer, isCorrect }]

      examQuestions = questions.map(q => {
        if (q.isCorrect) correctCount++;
        else if (q.selectedAnswer) wrongNumbers.push(parseInt(q.questionId)); // Only count as wrong if answered? or always? 
        // Better to rely on FE for wrongNumbers if possible, or recalculate them simply here.

        return {
          questionNumber: parseInt(q.questionId),
          selectedAnswer: q.selectedAnswer,
          isCorrect: q.isCorrect
        };
      });

      // Recalculate if not provided
      if (req.body.score === undefined) {
        calculatedScore = Math.round((correctCount / questions.length) * 100);
      } else {
        calculatedScore = req.body.score;
      }

      if (req.body.correctAnswers === undefined) {
        // correctCount is already calculated above
      } else {
        correctCount = req.body.correctAnswers;
      }

      if (req.body.wrongQuestionNumbers) {
        wrongNumbers = req.body.wrongQuestionNumbers;
      }
    }

    const totalQuestions = questions.length;
    const score = calculatedScore;
    const wrongQuestionNumbers = wrongNumbers;

    // Lưu kết quả
    const examResult = new ExamResult({
      studentId,
      questions: examQuestions,
      totalQuestions,
      correctAnswers: correctCount,
      score,
      category: category || 'Ngẫu nhiên',
      wrongQuestionNumbers,
      duration: duration || 0,
    });

    await examResult.save();

    // Populate để trả về thông tin đầy đủ
    const result = await ExamResult.findById(examResult._id)
      .populate('studentId', 'fullName phone');

    res.json({
      status: 'success',
      data: result,
      message: 'Exam submitted successfully',
    });
  } catch (error) {
    console.error('Error submitting exam:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy tất cả exam results
export const getAllExamResults = async (req, res) => {
  try {
    const { studentId } = req.query;
    const filter = {};

    if (studentId) filter.studentId = studentId;

    const results = await ExamResult.find(filter)
      .populate('studentId', 'fullName phone')
      .sort({ createdAt: -1 });

    res.json({
      status: 'success',
      data: results,
      count: results.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy exam result theo ID với thông tin đầy đủ câu hỏi từ API external
export const getExamResultById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ExamResult.findById(id)
      .populate('studentId');

    if (!result) {
      return res.status(404).json({
        status: 'error',
        message: 'Exam result not found',
      });
    }

    // Lấy thông tin đầy đủ các câu hỏi từ API external
    const questionsWithDetails = await Promise.all(
      result.questions.map(async (q) => {
        try {
          const questionData = await getQuestionByNumber(q.questionNumber);

          // Tìm đáp án đúng
          const labels = ['A', 'B', 'C', 'D'];
          const correctIndex = questionData.answers.findIndex(a => a.correct);
          const correctAnswer = correctIndex !== -1 ? labels[correctIndex] : null;

          // Chuyển đổi answers thành options
          const options = {};
          questionData.answers.forEach((answer, index) => {
            if (labels[index]) {
              options[labels[index]] = answer.text;
            }
          });

          return {
            questionNumber: q.questionNumber,
            questionContent: questionData.question,
            questionImage: questionData.hinhanhq || questionData.hinhanhqAlt || null,
            questionCategory: questionData.category,
            options,
            selectedAnswer: q.selectedAnswer,
            correctAnswer,
            explanation: questionData.explanation || null,
            isCorrect: q.isCorrect,
          };
        } catch (error) {
          console.error(`Error fetching question ${q.questionNumber}:`, error);
          // Trả về thông tin cơ bản nếu không lấy được từ API
          return {
            questionNumber: q.questionNumber,
            questionContent: `Câu hỏi số ${q.questionNumber}`,
            questionImage: null,
            questionCategory: null,
            options: {},
            selectedAnswer: q.selectedAnswer,
            correctAnswer: null,
            explanation: null,
            isCorrect: q.isCorrect,
          };
        }
      })
    );

    // Tạo object result với questions đầy đủ
    const resultWithDetails = {
      ...result.toObject(),
      questions: questionsWithDetails,
    };

    res.json({
      status: 'success',
      data: resultWithDetails,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

