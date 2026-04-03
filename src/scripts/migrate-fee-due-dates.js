/**
 * Script migrate: tính và lưu dueDate cho các đợt phí trong feePlanSnapshot
 * của tất cả Registration đang có.
 *
 * Chạy: npm run migrate-fee-dates
 *
 * Nếu đợt có dueDate rồi → giữ nguyên.
 * Nếu đợt chưa có dueDate → tính và lưu.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Registration from '../models/Registration.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import Payment from '../models/Payment.js';

// Helper: cộng ngày
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + (Number(days) || 0));
  return result;
};

const migrate = async () => {
  await connectDB();

  const registrations = await Registration.find({
    feePlanSnapshot: { $exists: true, $ne: [] },
  }).populate('batchId', 'courseId').populate('courseId', 'feePayments');

  console.log(`📋 Tìm thấy ${registrations.length} registration để migrate...\n`);

  let fixed = 0;
  let skipped = 0;

  for (const reg of registrations) {
    let changed = false;
    let prevDueDate = new Date(reg.createdAt);

    const newSnapshot = reg.feePlanSnapshot.map((fee, idx) => {
      // Giữ nguyên nếu đã có dueDate cố định
      if (fee.dueDate) {
        prevDueDate = new Date(fee.dueDate);
        return fee;
      }

      // Tính dueDate cascade từ prevDueDate
      // Đợt 1: prevDueDate = createdAt
      // Đợt 2+: cascade từ dueDate đợt trước
      const calculatedDue = addDays(prevDueDate, Number(fee.afterPreviousPaidDays) || 7);

      const oldDueDate = fee.dueDate;
      const newVal = calculatedDue.toISOString();

      if (!oldDueDate || new Date(oldDueDate).getTime() !== calculatedDue.getTime()) {
        changed = true;
        console.log(
          `  ✅ Reg ${reg._id} | Đợt ${idx + 1} "${fee.name || `Đợt ${idx + 1}`}": ${oldDueDate ? new Date(oldDueDate).toLocaleDateString('vi-VN') : 'null'} → ${calculatedDue.toLocaleDateString('vi-VN')}`
        );
        fee = fee.toObject ? { ...fee.toObject() } : { ...fee };
        fee.dueDate = calculatedDue;
      }

      prevDueDate = calculatedDue;
      return fee;
    });

    if (changed) {
      reg.feePlanSnapshot = newSnapshot;
      reg.markModified('feePlanSnapshot');
      await reg.save();
      fixed++;
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ Hoàn tất: ${fixed} registration đã fix, ${skipped} giữ nguyên`);
  await mongoose.connection.close();
  process.exit(0);
};

migrate().catch((e) => {
  console.error('❌ Lỗi:', e.message);
  process.exit(1);
});
