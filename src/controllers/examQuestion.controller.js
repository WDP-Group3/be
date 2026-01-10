import { getRandomQuestions, getQuestionByNumber } from '../services/externalApi.js';
import { getTopicBySlug, getAllTopics } from '../config/topics.js';

// Lấy danh sách topics
export const getTopics = async (req, res) => {
  try {
    const topics = getAllTopics();
    res.json({
      status: 'success',
      data: topics,
      count: topics.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy đề thi ngẫu nhiên (không bao gồm đáp án đúng)
export const getRandomExam = async (req, res) => {
  try {
    const { count = 35, category } = req.query;
    const limit = parseInt(count);
    
    let categorySlug = category;
    
    // Nếu có category, verify topic exists
    if (category) {
      const topic = getTopicBySlug(category);
      if (topic) {
        categorySlug = topic.slug;
      }
    }
    
    // Lấy câu hỏi ngẫu nhiên từ API external
    const questions = await getRandomQuestions(limit, categorySlug);
    
    // Loại bỏ đáp án đúng để tránh gian lận
    const questionsWithoutAnswer = questions.map(q => ({
      _id: q._id,
      number: q.number,
      content: q.content,
      question: q.question,
      image: q.image,
      category: q.category,
      options: q.options,
    }));
    
    res.json({
      status: 'success',
      data: questionsWithoutAnswer,
      count: questionsWithoutAnswer.length,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

// Lấy exam question theo number
export const getExamQuestionById = async (req, res) => {
  try {
    const { id } = req.params;
    const number = parseInt(id);
    
    if (isNaN(number) || number < 1 || number > 600) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid question number. Must be between 1 and 600',
      });
    }
    
    const question = await getQuestionByNumber(number);
    
    // Chuyển đổi format
    const labels = ['A', 'B', 'C', 'D'];
    const correctIndex = question.answers.findIndex(a => a.correct);
    const options = {};
    question.answers.forEach((answer, index) => {
      if (labels[index]) {
        options[labels[index]] = answer.text;
      }
    });
    
    const formattedQuestion = {
      _id: question.number.toString(),
      number: question.number,
      content: question.question,
      question: question.question,
      image: question.hinhanhq || question.hinhanhqAlt || null,
      category: question.category,
      explanation: question.explanation,
      options,
      correctAnswer: correctIndex !== -1 ? labels[correctIndex] : null,
    };
    
    res.json({
      status: 'success',
      data: formattedQuestion,
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
    });
  }
};

