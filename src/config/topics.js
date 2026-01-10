/**
 * Cấu hình các topic (chủ đề) thi lý thuyết lái xe
 * Mapping từ tên topic sang category slug và số lượng câu hỏi
 */
export const TOPICS = {
  'khai-niem': {
    name: 'Khái niệm',
    slug: 'khai-niem',
    totalQuestions: 180,
  },
  'van-hoa': {
    name: 'Văn hóa',
    slug: 'van-hoa',
    totalQuestions: 35,
  },
  'ky-thuat': {
    name: 'Kỹ thuật',
    slug: 'ky-thuat',
    totalQuestions: 50,
  },
  'cau-tao': {
    name: 'Cấu tạo',
    slug: 'cau-tao',
    totalQuestions: 40,
  },
  'bien-bao': {
    name: 'Biển báo',
    slug: 'bien-bao',
    totalQuestions: 120,
  },
  'tinh-huong': {
    name: 'Tình huống',
    slug: 'tinh-huong',
    totalQuestions: 115,
  },
};

/**
 * Lấy thông tin topic theo slug
 */
export const getTopicBySlug = (slug) => {
  return TOPICS[slug] || null;
};

/**
 * Lấy tất cả topics
 */
export const getAllTopics = () => {
  return Object.values(TOPICS);
};

