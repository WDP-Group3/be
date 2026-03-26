/**
 * Script test ACID payment system
 * Chạy: cd be && node scripts/test-acid-payment.js
 *
 * Tự động tạo test data, chạy test, cleanup.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://admin:admin123%40@banglaixe.8aade9o.mongodb.net/banglaixe?retryWrites=true&w=majority';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Mock env trước khi import controller
process.env.SEPAY_WEBHOOK_API_KEY = 'test-webhook-key';

async function testAcidPayment() {
  console.log('═══════════════════════════════════════════════');
  console.log('   TEST: ACID Payment System');
  console.log('═══════════════════════════════════════════════\n');

  const Transaction = (await import('../src/models/Transaction.js')).default;
  const Payment = (await import('../src/models/Payment.js')).default;
  const Registration = (await import('../src/models/Registration.js')).default;
  const User = (await import('../src/models/User.js')).default;
  const Course = (await import('../src/models/Course.js')).default;

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // ═══════════════════════════════════════════════════════
    // SETUP: Tạo test data riêng
    // ═══════════════════════════════════════════════════════
    const TEST_PREFIX = `TEST-ACID-${Date.now()}`;
    const testEmail = `acid-test-${Date.now()}@test.com`;

    // 1. Tạo test learner
    const testLearner = await User.create({
      fullName: 'Test Learner ACID',
      email: testEmail,
      phone: '0909000000',
      role: 'learner',
      status: 'ACTIVE',
      password: '$2a$10$dummy',
    });
    console.log(`✓ Created test learner: ${testLearner.email}`);

    // 2. Tìm hoặc tạo course
    let course = await Course.findOne();
    if (!course) {
      course = await Course.create({
        code: 'A1', name: 'Bằng lái xe máy A1',
        estimatedCost: 2000000,
        feePayments: [{ name: 'Đợt 1', amount: 1000000 }, { name: 'Đợt 2', amount: 1000000 }],
        status: 'Active',
      });
    }
    console.log(`✓ Using course: ${course.name}`);

    // 3. Tạo registration
    const testReg = await Registration.create({
      learnerId: testLearner._id,
      courseId: course._id,
      registerMethod: 'ONLINE',
      status: 'NEW',
      paymentPlanType: 'INSTALLMENT',
      feePlanSnapshot: [{ name: 'Đợt 1', amount: 1000000 }, { name: 'Đợt 2', amount: 1000000 }],
    });
    console.log(`✓ Created registration: ${testReg._id}`);

    // ─── Mock req/res cho controller ───────────────────────────────────
    const makeMockRes = () => {
      const res = { _status: 200, _data: null };
      res.status = (code) => { res._status = code; return res; };
      res.json = (data) => { res._data = data; return res; };
      return res;
    };

    const { checkStatus, confirmTransaction } = await import('../src/controllers/transaction.controller.js');

    let PASS = 0;
    let FAIL = 0;
    const pass = () => { PASS++; console.log(`  ✅ PASS`); };
    const fail = (msg) => { FAIL++; console.log(`  ❌ FAIL: ${msg}`); };

    // ═══════════════════════════════════════════════════════
    // TEST 1: Idempotency — checkStatus gọi 2 lần
    // ═══════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────');
    console.log(' TEST 1: Idempotency — checkStatus (webhook)');
    console.log('─────────────────────────────────────────────');

    // Tạo transaction pending
    const tx1 = await Transaction.create({
      amount: 50000,
      transferContent: `${TEST_PREFIX}-T1`,
      user: testLearner._id,
      registrationId: testReg._id,
      status: 'pending',
    });
    tx1.idempotencyKey = String(tx1._id);
    await tx1.save();
    console.log(`  Created tx: ${tx1._id}`);

    // Lần 1
    console.log('\n  → Lần 1: checkStatus...');
    const res1 = makeMockRes();
    await checkStatus(
      { headers: { authorization: 'ApiKey test-webhook-key' }, body: { transferContent: `${TEST_PREFIX}-T1`, amount: 50000 } },
      res1
    );
    console.log(`    Status: ${res1._status}, paymentCreated: ${res1._data?.data?.paymentCreated}`);

    const tx1After = await Transaction.findById(tx1._id);
    const pay1Count = await Payment.countDocuments({ registrationId: testReg._id, amount: 50000 });

    if (tx1After.paymentId && pay1Count === 1) {
      console.log(`    Tx.paymentId set: ${tx1After.paymentId}`);
      pass();
    } else {
      fail(`paymentId=${tx1After.paymentId}, payCount=${pay1Count}`);
    }

    // Lần 2 — phải skip
    console.log('\n  → Lần 2: checkStatus (idempotent skip)...');
    const res2 = makeMockRes();
    await checkStatus(
      { headers: { authorization: 'ApiKey test-webhook-key' }, body: { transferContent: `${TEST_PREFIX}-T1`, amount: 50000 } },
      res2
    );
    console.log(`    Status: ${res2._status}, alreadyProcessed: ${res2._data?.data?.alreadyProcessed}`);

    const pay1CountAfter = await Payment.countDocuments({ registrationId: testReg._id, amount: 50000 });
    if (res2._data?.data?.alreadyProcessed === true && pay1CountAfter === 1) {
      pass();
    } else {
      fail(`alreadyProcessed=${res2._data?.data?.alreadyProcessed}, payCount=${pay1CountAfter}`);
    }

    // ═══════════════════════════════════════════════════════
    // TEST 2: Idempotency — confirmTransaction gọi 2 lần
    // ═══════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────');
    console.log(' TEST 2: Idempotency — confirmTransaction');
    console.log('─────────────────────────────────────────────');

    const tx2 = await Transaction.create({
      amount: 75000,
      transferContent: `${TEST_PREFIX}-T2`,
      user: testLearner._id,
      registrationId: testReg._id,
      status: 'pending',
    });
    tx2.idempotencyKey = String(tx2._id);
    await tx2.save();
    console.log(`  Created tx: ${tx2._id}`);

    // Lần 1
    console.log('\n  → Lần 1: confirmTransaction...');
    const res3 = makeMockRes();
    await confirmTransaction({ params: { id: tx2._id.toString() }, user: { role: 'ADMIN' } }, res3);
    console.log(`    Status: ${res3._status}, paymentCreated: ${res3._data?.data?.paymentCreated}`);

    const tx2After = await Transaction.findById(tx2._id);
    const pay2Count = await Payment.countDocuments({ registrationId: testReg._id, note: { $regex: /Admin xác nhận/ } });

    if (tx2After.paymentId && pay2Count === 1) {
      console.log(`    Tx.paymentId set: ${tx2After.paymentId}`);
      pass();
    } else {
      fail(`paymentId=${tx2After.paymentId}, adminPayCount=${pay2Count}`);
    }

    // Lần 2 — phải skip
    console.log('\n  → Lần 2: confirmTransaction (idempotent skip)...');
    const res4 = makeMockRes();
    await confirmTransaction({ params: { id: tx2._id.toString() }, user: { role: 'ADMIN' } }, res4);
    console.log(`    Status: ${res4._status}, alreadyProcessed: ${res4._data?.data?.alreadyProcessed}`);

    const pay2CountAfter = await Payment.countDocuments({ registrationId: testReg._id, note: { $regex: /Admin xác nhận/ } });
    if (res4._data?.data?.alreadyProcessed === true && pay2CountAfter === 1) {
      pass();
    } else {
      fail(`alreadyProcessed=${res4._data?.data?.alreadyProcessed}, adminPayCount=${pay2CountAfter}`);
    }

    // ═══════════════════════════════════════════════════════
    // TEST 3: Confirm khi paymentId đã set — luôn skip
    // ═══════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────');
    console.log(' TEST 3: Confirm khi paymentId đã tồn tại');
    console.log('─────────────────────────────────────────────');

    const res5 = makeMockRes();
    await confirmTransaction({ params: { id: tx2._id.toString() }, user: { role: 'ADMIN' } }, res5);
    console.log(`    Status: ${res5._status}, alreadyProcessed: ${res5._data?.data?.alreadyProcessed}`);

    if (res5._data?.data?.alreadyProcessed === true) {
      pass();
    } else {
      fail('should skip when paymentId exists');
    }

    // ═══════════════════════════════════════════════════════
    // TEST 4: Transaction model fields
    // ═══════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────');
    console.log(' TEST 4: Transaction model fields');
    console.log('─────────────────────────────────────────────');

    const txFields = Object.keys(tx1After.toObject());
    const hasIdempotencyKey = txFields.includes('idempotencyKey');
    const hasPaymentId = txFields.includes('paymentId');

    console.log(`    idempotencyKey field exists: ${hasIdempotencyKey}`);
    console.log(`    paymentId field exists: ${hasPaymentId}`);

    if (hasIdempotencyKey && hasPaymentId) {
      pass();
    } else {
      fail(`idempotencyKey=${hasIdempotencyKey}, paymentId=${hasPaymentId}`);
    }

    // ═══════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════
    console.log('\n─────────────────────────────────────────────');
    console.log(' CLEANUP');
    console.log('─────────────────────────────────────────────');

    await Transaction.deleteMany({ transferContent: { $regex: new RegExp(TEST_PREFIX) } });
    await Payment.deleteMany({ registrationId: testReg._id });
    await Registration.findByIdAndDelete(testReg._id);
    await User.findByIdAndDelete(testLearner._id);

    console.log('✓ Deleted test transactions, payments, registration, learner\n');

    // ═══════════════════════════════════════════════════════
    // KẾT QUẢ
    // ═══════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════');
    console.log('   KẾT QUẢ');
    console.log('═══════════════════════════════════════════════');
    console.log(`   ✅ PASS: ${PASS}`);
    console.log(`   ❌ FAIL: ${FAIL}`);
    console.log(`   Tổng:   ${PASS + FAIL}`);
    console.log('\n═══════════════════════════════════════════════\n');

    await mongoose.disconnect();
    process.exit(FAIL > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    console.error(error.stack);

    // Cleanup trước khi exit
    try {
      await Transaction.deleteMany({ transferContent: { $regex: /TEST-ACID-/ } });
      await Payment.deleteMany({ registrationId: { $exists: true } });
    } catch (_) {}

    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

testAcidPayment();
