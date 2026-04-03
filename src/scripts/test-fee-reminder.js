/**
 * Script test thủ công cho cron nhắc học phí
 * Chạy: node src/scripts/test-fee-reminder.js
 *
 * Script này gọi trực tiếp hàm checkAndSendDueDateReminders()
 * mà không cần chờ cron chạy lúc 09:00 mỗi ngày.
 */
import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';

// Load env trước khi import cron service (nó đọc process.env)
dotenv.config();

import { checkAndSendDueDateReminders } from '../services/cron.job.js';

const main = async () => {
  console.log('🧪 [TEST FEE REMINDER] Bắt đầu test cron nhắc học phí...\n');

  await connectDB();
  console.log('✅ Đã kết nối MongoDB\n');

  // Log cấu hình hiện tại
  const config = {
    enabled: process.env.FEE_REMINDER_ENABLED !== 'false',
    daysBefore: process.env.FEE_REMINDER_DAYS_BEFORE || '7,3,1,0',
    daysOverdue: process.env.FEE_REMINDER_DAYS_OVERDUE || '1,3,7',
    adminThreshold: process.env.FEE_REMINDER_ADMIN_THRESHOLD || '7',
  };
  console.log('📋 Cấu hình:', config, '\n');

  try {
    await checkAndSendDueDateReminders();
    console.log('\n✅ [TEST] Hoàn tất test cron nhắc học phí');
  } catch (error) {
    console.error('\n❌ [TEST] Lỗi:', error.message);
  }

  process.exit(0);
};

main();
