/**
 * dateHelper.js — Utility timezone-safe cho ngày tháng (Asia/Ho_Chi_Minh / UTC+7)
 */

/**
 * Trả về ngày đầu tiên (00:00:00.000) của một ngày trong múi giờ Việt Nam.
 * @param {Date|string} date
 * @returns {Date} Date object tại 00:00:00 UTC (tương đương 07:00 ICT)
 */
export const startOfDayICT = (date) => {
  const d = new Date(date);
  const str = d.toLocaleString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  // "YYYY-MM-DDTHH:mm:ss" → "YYYY-MM-DDT00:00:00"
  return new Date(str.substring(0, 10) + 'T00:00:00.000Z');
};

/**
 * Tính số ngày chênh lệch giữa 2 ngày (timezone-safe, UTC+7).
 * @param {Date|string} dateA  - Ngày gốc (dueDate)
 * @param {Date|string} dateB  - Ngày so sánh (thường là now)
 * @returns {number} Số ngày chênh lệch:
 *   > 0 = dateA còn trước dateB (còn hạn)
 *   = 0 = cùng ngày (đến hạn hôm nay)
 *   < 0 = dateA đã qua dateB (quá hạn)
 */
export const getDaysDiff = (dateA, dateB) => {
  const a = startOfDayICT(dateA);
  const b = startOfDayICT(dateB);
  return Math.round((a - b) / (1000 * 60 * 60 * 24));
};

/**
 * Cộng số ngày vào một ngày (timezone-safe).
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date}
 */
export const addDays = (date, days) => {
  const d = startOfDayICT(date);
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d;
};
