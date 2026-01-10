import axios from 'axios';

const EXTERNAL_API_URL = 'https://taplai.com/jshuy/600cau2025/get_question.php';

/**
 * Lấy câu hỏi từ API external
 * @param {number} number - Số thứ tự câu hỏi (1-600)
 * @returns {Promise<Object>} Câu hỏi từ API
 */
export const getQuestionByNumber = async (number) => {
  try {
    const response = await axios.get(`${EXTERNAL_API_URL}?number=${number}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching question ${number}:`, error.message);
    throw new Error(`Không thể lấy câu hỏi số ${number}`);
  }
};

/**
 * Lấy tất cả câu hỏi theo category từ API external
 * @param {string} category - Category slug (ví dụ: 'van-hoa', 'khai-niem')
 * @returns {Promise<Array>} Mảng câu hỏi theo category
 */
export const getQuestionsByCategory = async (category) => {
  try {
    const response = await axios.get(`${EXTERNAL_API_URL}?category=${category}`);
    // API trả về array hoặc single object
    const data = Array.isArray(response.data) ? response.data : [response.data];
    return data;
  } catch (error) {
    console.error(`Error fetching questions by category ${category}:`, error.message);
    throw new Error(`Không thể lấy câu hỏi theo chủ đề ${category}`);
  }
};

/**
 * Lấy nhiều câu hỏi ngẫu nhiên
 * @param {number} count - Số lượng câu hỏi cần lấy
 * @param {string} category - Category slug để lọc (optional). Nếu có, sẽ gọi API với category parameter
 * @returns {Promise<Array>} Mảng câu hỏi
 */
export const getRandomQuestions = async (count = 35, category = null) => {
  try {
    let questions = [];
    
    // Nếu có category, gọi API với category parameter
    if (category) {
      // Lấy tất cả câu hỏi theo category từ API
      const allQuestions = await getQuestionsByCategory(category);
      questions = allQuestions;
    } else {
      // Không có category, lấy random từ 1-600
      const minNumber = 1;
      const maxNumber = 600;
      const numbers = new Set();
      let attempts = 0;
      const maxAttempts = 1000;
      
      while (numbers.size < count && attempts < maxAttempts) {
        const randomNumber = Math.floor(Math.random() * (maxNumber - minNumber + 1)) + minNumber;
        numbers.add(randomNumber);
        attempts++;
      }
      
      const questionNumbers = Array.from(numbers);
      const promises = questionNumbers.map(num => getQuestionByNumber(num).catch(err => null));
      const fetchedQuestions = await Promise.all(promises);
      
      // Loại bỏ null và lấy số lượng cần thiết
      questions = fetchedQuestions.filter(q => q !== null).slice(0, count);
    }
    
    // Chuyển đổi format để phù hợp với frontend
    return questions.map((q) => ({
      _id: q.number.toString(), // Dùng number làm ID
      number: q.number,
      content: q.question,
      question: q.question,
      image: q.hinhanhq || q.hinhanhqAlt || null,
      category: q.category,
      explanation: q.explanation,
      // Chuyển đổi answers thành options format A, B, C, D
      options: convertAnswersToOptions(q.answers),
      // Lưu thông tin đáp án đúng
      correctAnswerIndex: q.answers.findIndex(a => a.correct),
    }));
  } catch (error) {
    console.error('Error fetching random questions:', error);
    throw error;
  }
};

/**
 * Chuyển đổi answers array thành options object (A, B, C, D)
 * @param {Array} answers - Mảng đáp án từ API
 * @returns {Object} Object với keys A, B, C, D
 */
const convertAnswersToOptions = (answers) => {
  const options = {};
  const labels = ['A', 'B', 'C', 'D'];
  
  answers.forEach((answer, index) => {
    if (labels[index]) {
      options[labels[index]] = answer.text;
    }
  });
  
  return options;
};

/**
 * Lấy câu hỏi với đáp án đúng (cho chấm điểm)
 * @param {number} number - Số thứ tự câu hỏi
 * @returns {Promise<Object>} Câu hỏi với thông tin đáp án đúng
 */
export const getQuestionWithAnswer = async (number) => {
  try {
    const question = await getQuestionByNumber(number);
    
    // Tìm đáp án đúng
    const correctIndex = question.answers.findIndex(a => a.correct);
    const correctAnswer = correctIndex !== -1 ? ['A', 'B', 'C', 'D'][correctIndex] : null;
    
    return {
      ...question,
      correctAnswer,
      correctAnswerIndex: correctIndex,
    };
  } catch (error) {
    console.error(`Error fetching question ${number} with answer:`, error);
    throw error;
  }
};

