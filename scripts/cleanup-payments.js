/**
 * Cleanup script - Xoá toàn bộ dữ liệu thanh toán
 *
 * Usage:
 *   node scripts/cleanup-payments.js [--dry-run] [--full]
 *
 * Options:
 *   --dry-run  Chỉ hiển thị số lượng records sẽ xoá, không xoá thật
 *   --full     Xoá cả payment, transaction, invoice và reset registration
 *
 * Collections bị ảnh hưởng:
 *   - payments
 *   - transactions
 *   - invoices
 *   - registrations (reset firstPaymentDate, status)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const full = args.includes('--full');

async function getCollectionStats(db) {
  const stats = {};

  const collections = ['Payment', 'Transaction', 'Invoice'];
  for (const name of collections) {
    try {
      const count = await db.collection(name.toLowerCase() + 's').estimatedDocumentCount();
      stats[name] = count;
    } catch {
      stats[name] = 0;
    }
  }

  // Count registrations with firstPaymentDate or non-DRAFT
  try {
    const regStats = await db.collection('registrations').aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withFirstPayment: {
            $sum: { $cond: [{ $ne: ['$firstPaymentDate', null] }, 1, 0] },
          },
          processing: {
            $sum: { $cond: [{ $eq: ['$status', 'PROCESSING'] }, 1, 0] },
          },
        },
      },
    ]).toArray();
    stats.registrations = regStats[0] || { total: 0, withFirstPayment: 0, processing: 0 };
  } catch {
    stats.registrations = { total: 0, withFirstPayment: 0, processing: 0 };
  }

  return stats;
}

async function cleanup() {
  console.log('\n🧹 Payment Cleanup Script');
  console.log('='.repeat(50));

  if (dryRun) {
    console.log('⚠️  DRY RUN — Không xoá gì cả, chỉ hiển thị thống kê\n');
  } else if (full) {
    console.log('🔥 FULL CLEANUP — Xoá payments, transactions, invoices + reset registrations\n');
  } else {
    console.log('📋 STANDARD — Xoá payments, transactions, invoices (không reset registrations)\n');
  }

  await connectDB();
  const db = mongoose.connection.db;

  // Stats trước
  const before = await getCollectionStats(db);
  console.log('📊 TRƯỚC KHI XOÁ:');
  console.log(`   Payments:      ${before.Payment} records`);
  console.log(`   Transactions:  ${before.Transaction} records`);
  console.log(`   Invoices:      ${before.Invoice} records`);
  console.log(`   Registrations: ${before.registrations.total} total`);
  console.log(`     - Có firstPaymentDate: ${before.registrations.withFirstPayment}`);
  console.log(`     - Status PROCESSING:    ${before.registrations.processing}`);

  if (dryRun) {
    console.log('\n⚠️  DRY RUN — Kết thúc ở đây (không xoá gì)');
    await mongoose.connection.close();
    return;
  }

  // Xoá Payment
  console.log('\n🗑️  Xoá Payment records...');
  const pResult = await db.collection('payments').deleteMany({});
  console.log(`   ✅ Đã xoá ${pResult.deletedCount} payment records`);

  // Xoá Transaction
  console.log('🗑️  Xoá Transaction records...');
  const tResult = await db.collection('transactions').deleteMany({});
  console.log(`   ✅ Đã xoá ${tResult.deletedCount} transaction records`);

  // Xoá Invoice
  console.log('🗑️  Xoá Invoice records...');
  const iResult = await db.collection('invoices').deleteMany({});
  console.log(`   ✅ Đã xoá ${iResult.deletedCount} invoice records`);

  // Reset registrations
  if (full) {
    console.log('🗑️  Reset registrations (xoá firstPaymentDate, đặt lại status)...');
    const rResult = await db.collection('registrations').updateMany(
      { firstPaymentDate: { $ne: null } },
      {
        $set: {
          firstPaymentDate: null,
          status: 'NEW',
        },
      }
    );
    console.log(`   ✅ Đã reset ${rResult.modifiedCount} registration records`);
  }

  // Stats sau
  const after = await getCollectionStats(db);
  console.log('\n📊 SAU KHI XOÁ:');
  console.log(`   Payments:      ${after.Payment} records`);
  console.log(`   Transactions:  ${after.Transaction} records`);
  console.log(`   Invoices:      ${after.Invoice} records`);
  if (full) {
    console.log(`   Registrations: ${after.registrations.withFirstPayment} có firstPaymentDate (đã reset)`);
  }

  console.log('\n✅ Hoàn tất!');
  await mongoose.connection.close();
}

cleanup().catch(async (err) => {
  console.error('❌ Lỗi:', err.message);
  await mongoose.connection.close();
  process.exit(1);
});
