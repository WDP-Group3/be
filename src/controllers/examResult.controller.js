import ExamResult from '../models/ExamResult.js';
import { getQuestionByNumber } from '../services/externalApi.js';

// Nộp bài và chấm điểm
export const submitExam = async (req, res) => {
  try {
    const { studentId, questions, duration } = req.body;
    
    if (!studentId || !questions || !Array.isArray(questions)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid request data',
      });
    }
    
    // Lấy đáp án đúng từ API external và lưu đầy đủ thông tin câu hỏi
    const examQuestions = [];
    let correctCount = 0;
    const wrongQuestionNumbers = [];
    
    for (const q of questions) {
      // questionId từ frontend sẽ là number (string)
      const questionNumber = parseInt(q.questionId);
      
      if (isNaN(questionNumber)) {
        continue;
      }
      
      // Lấy thông tin đầy đủ câu hỏi từ API
      const questionData = await getQuestionByNumber(questionNumber);
      
      // Xác định đáp án đúng
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
      
      // So sánh với đáp án đã chọn
      const isCorrect = q.selectedAnswer === correctAnswer;
      
      if (isCorrect) {
        correctCount++;
      } else {
        wrongQuestionNumbers.push(questionNumber);
      }
      
      examQuestions.push({
        questionNumber,
        selectedAnswer: q.selectedAnswer || null,
        isCorrect,
      });
    }
    
    const totalQuestions = questions.length;
    const score = Math.round((correctCount / totalQuestions) * 100);
    
    // Lưu kết quả
    const examResult = new ExamResult({
      studentId,
      questions: examQuestions,
      totalQuestions,
      correctAnswers: correctCount,
      score,
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

